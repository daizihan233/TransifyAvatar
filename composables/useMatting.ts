// filepath: e:/transify_avatar/composables/useMatting.ts
// AI 抠像（去背景）基于 Transformers.js RMBG-1.4 模型（image-segmentation pipeline）
// 仅在浏览器端加载与运行

import { ref } from 'vue'
import { useRuntimeConfig } from '#app'

let pipePromise: Promise<any> | null = null
let initialized = false

async function ensureLoaded() {
  if (!process.client) throw new Error('Matting can only run in browser')
  if (initialized && pipePromise) return

  const { pipeline, env } = await import('@huggingface/transformers')
  const { public: { hfAccessToken } } = useRuntimeConfig()

  if ((env as any)?.backends?.onnx?.wasm) {
    ;(env as any).backends.onnx.wasm.proxy = true
  }
  ;(env as any).useBrowserCache = true

  const tryIds = hfAccessToken ? ['briaai/RMBG-2.0', 'briaai/RMBG-1.4'] : ['briaai/RMBG-1.4']
  let lastErr: any = null
  for (const id of tryIds) {
    try {
      pipePromise = pipeline('image-segmentation', id)
      initialized = true
      return
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr || new Error('Failed to initialize matting pipeline')
}

export function useMatting() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 输入：裁剪后的 dataURL（PNG/JPEG 均可）
  // 输出：PNG dataURL，带透明通道。
  async function removeBg(
    dataUrl: string,
    onProgress?: (stage: string, percent?: number) => void,
  ): Promise<string> {
    if (!dataUrl) throw new Error('No image provided')
    loading.value = true
    error.value = null
    try {
      onProgress?.('loading model', 10)
      await ensureLoaded()
      const pipe = await pipePromise!
      onProgress?.('model ready', 20)

      const { RawImage } = await import('@huggingface/transformers')
      onProgress?.('reading image', 30)
      const image = await RawImage.fromURL(dataUrl)

      // pipeline 内部包含预处理与后处理
      onProgress?.('infer', 70)
      const out = await pipe(image)

      // out 可能是：
      // 1) 直接的 RawImage（已带透明通道的前景图）
      // 2) 对象包含 mask（RawImage）
      // 3) 其他结构（少见），尽量兼容
      const toCanvasDataUrl = (ri: any, targetW: number, targetH: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = targetW
        canvas.height = targetH
        const ctx = canvas.getContext('2d')!
        const srcCanvas = typeof ri?.toCanvas === 'function' ? ri.toCanvas() : ri
        if (ri?.width === targetW && ri?.height === targetH) {
          ctx.drawImage(srcCanvas, 0, 0)
        } else {
          ctx.drawImage(srcCanvas, 0, 0, ri.width, ri.height, 0, 0, targetW, targetH)
        }
        return canvas.toDataURL('image/png')
      }

      let resultDataUrl: string | null = null

      // 情况 1：已是 cutout RawImage（直接绘制缩放到原尺寸）
      if (out && typeof out.toCanvas === 'function' && typeof out.width === 'number') {
        onProgress?.('composite', 90)
        resultDataUrl = toCanvasDataUrl(out, image.width, image.height)
      }
      // 情况 2：存在 mask，用 mask 合成
      else if (out && out.mask && typeof out.mask.toCanvas === 'function') {
        onProgress?.('resize mask', 80)
        const maskRI = out.mask
        // 将 mask 缩放至原图大小，并写入 alpha 通道
        onProgress?.('composite', 90)
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(image.toCanvas(), 0, 0)

        const pixelData = ctx.getImageData(0, 0, image.width, image.height)
        const maskCanvas = maskRI.toCanvas()
        // 将 mask 绘制到同尺寸临时画布再读取灰度作为 alpha
        const m = document.createElement('canvas')
        m.width = image.width
        m.height = image.height
        const mctx = m.getContext('2d')!
        mctx.drawImage(maskCanvas, 0, 0, maskRI.width, maskRI.height, 0, 0, image.width, image.height)
        const maskData = mctx.getImageData(0, 0, image.width, image.height).data
        for (let i = 0; i < image.width * image.height; i++) {
          // 使用 mask 的红通道作为 alpha（mask 是灰度）
          pixelData.data[4 * i + 3] = maskData[4 * i] ?? 0
        }
        ctx.putImageData(pixelData, 0, 0)
        resultDataUrl = canvas.toDataURL('image/png')
      }
      // 情况 3：未知结构，尝试将其视为 RawImage canvas 处理
      else if (out && out.width && out.height) {
        onProgress?.('composite', 90)
        resultDataUrl = toCanvasDataUrl(out, image.width, image.height)
      }

      if (resultDataUrl === null) throw new Error('Unexpected pipeline output')

      onProgress?.('done', 100)
      return resultDataUrl
    } catch (e: any) {
      error.value = e?.message || String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  return { removeBg, loading, error }
}
