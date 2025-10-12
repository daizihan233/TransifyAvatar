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

export type MattingBackend = 'transformers' | 'imgly'

export function useMatting() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 输入：裁剪后的 dataURL（PNG/JPEG 均可）
  // 输出：PNG dataURL，带透明通道。
  async function removeBg(
    dataUrl: string,
    onProgress?: (stage: string, percent?: number) => void,
    options?: { backend?: MattingBackend }
  ): Promise<string> {
    const backend: MattingBackend = options?.backend ?? 'transformers'

    if (!dataUrl) throw new Error('No image provided')
    loading.value = true
    error.value = null
    try {
      if (backend === 'imgly') {
        onProgress?.('loading model', 10)
        // 动态引入，避免在未选择时增加包体或构建风险
        let removeBackground: any
        try {
          // @ts-ignore - dynamic import at runtime
          ;({ removeBackground } = await import('@imgly/background-removal'))
        } catch (e) {
          throw new Error('请先安装依赖：@imgly/background-removal')
        }
        onProgress?.('reading image', 30)
        // 该库接受 URL/HTMLImageElement/Blob；这里直接传 dataURL
        onProgress?.('infer', 70)
        const blob: Blob = await removeBackground(dataUrl)
        onProgress?.('composite', 90)
        const asDataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader()
          fr.onerror = () => reject(new Error('读取输出失败'))
          fr.onload = () => resolve(String(fr.result))
          fr.readAsDataURL(blob)
        })
        onProgress?.('done', 100)
        return asDataUrl
      }

      // 默认使用 Transformers RMBG
      onProgress?.('loading model', 10)
      await ensureLoaded()
      const pipe = await pipePromise!
      onProgress?.('model ready', 20)

      const { RawImage } = await import('@huggingface/transformers')
      onProgress?.('reading image', 30)
      const image = await RawImage.fromURL(dataUrl)

      // pipeline 内部包含预处理与后处理
      onProgress?.('infer', 70)
      const rawOut = await pipe(image)

      // 抽取一个工具：尽最大可能把输入转为 CanvasImageSource
      const asDrawable = (src: any): { drawable: CanvasImageSource, width: number, height: number } | null => {
        try {
          if (!src) return null
          // RawImage（transformers）
          if (typeof src?.toCanvas === 'function' && typeof src?.width === 'number' && typeof src?.height === 'number') {
            const c = src.toCanvas()
            return { drawable: c, width: src.width, height: src.height }
          }
          // 直接 Canvas
          if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) {
            return { drawable: src, width: src.width, height: src.height }
          }
          // OffscreenCanvas
          if (typeof OffscreenCanvas !== 'undefined' && src instanceof OffscreenCanvas) {
            // OffscreenCanvas 也可直接 drawImage
            // 宽高读取方式不同
            // @ts-ignore
            return { drawable: src as unknown as CanvasImageSource, width: (src as any).width, height: (src as any).height }
          }
          // ImageBitmap
          if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) {
            return { drawable: src, width: src.width, height: src.height }
          }
          // HTMLImageElement
          if (typeof Image !== 'undefined' && src instanceof Image) {
            return { drawable: src, width: src.naturalWidth || src.width, height: src.naturalHeight || src.height }
          }
          // 可能是 { canvas }
          if (src?.canvas && typeof src.canvas?.toDataURL === 'function') {
            const c = src.canvas as HTMLCanvasElement
            return { drawable: c, width: c.width, height: c.height }
          }
          return null
        } catch {
          return null
        }
      }

      // 规范化 pipeline 输出
      type Normalized =
        | { kind: 'dataurl'; data: string }
        | { kind: 'cutout'; image: any }
        | { kind: 'mask'; mask: any }
        | { kind: 'unknownCanvasLike'; any: any }
        | null

      const normalizeOutput = (out: any): Normalized => {
        // 直接 dataURL 字符串
        if (typeof out === 'string' && out.startsWith('data:')) return { kind: 'dataurl', data: out }

        // 数组：取第一个有效项
        if (Array.isArray(out)) {
          for (const item of out) {
            if (!item) continue
            // 可能返回字符串 dataURL
            if (typeof (item as any)?.startsWith === 'function' && (item as any).startsWith('data:')) {
              return { kind: 'dataurl', data: item as unknown as string }
            }
            if (typeof (item as any)?.toCanvas === 'function') return { kind: 'cutout', image: item }
            if ((item as any)?.image && typeof (item as any).image?.toCanvas === 'function') return { kind: 'cutout', image: (item as any).image }
            if ((item as any)?.mask && typeof (item as any).mask?.toCanvas === 'function') return { kind: 'mask', mask: (item as any).mask }
            // 直接可绘制
            const draw = asDrawable(item)
            if (draw) return { kind: 'unknownCanvasLike', any: item }
          }
          // 回退：数组首项
          const first = out[0]
          const draw = asDrawable(first)
          if (draw) return { kind: 'unknownCanvasLike', any: first }
          return null
        }

        // 直接 RawImage
        if (out && typeof out.toCanvas === 'function' && typeof out.width === 'number') return { kind: 'cutout', image: out }
        // 对象包含 image
        if (out?.image && typeof out.image?.toCanvas === 'function') return { kind: 'cutout', image: out.image }
        // 对象包含 mask
        if (out?.mask && typeof out.mask?.toCanvas === 'function') return { kind: 'mask', mask: out.mask }
        // 兜底：可绘制对象
        const draw = asDrawable(out)
        if (draw) return { kind: 'unknownCanvasLike', any: out }
        return null
      }

      const out = normalizeOutput(rawOut)

      const toCanvasDataUrl = (src: any, targetW: number, targetH: number) => {
        const canvas = document.createElement('canvas')
        canvas.width = targetW
        canvas.height = targetH
        const ctx = canvas.getContext('2d')!
        const drawable = asDrawable(src)
        if (!drawable) throw new Error('Output is not drawable')
        const { drawable: srcDrawable, width: sw, height: sh } = drawable
        if (sw === targetW && sh === targetH) {
          ctx.drawImage(srcDrawable, 0, 0)
        } else {
          ctx.drawImage(srcDrawable, 0, 0, sw, sh, 0, 0, targetW, targetH)
        }
        return canvas.toDataURL('image/png')
      }

      let resultDataUrl: string | null = null

      if (out?.kind === 'dataurl') {
        onProgress?.('composite', 90)
        resultDataUrl = out.data ?? null
      }
      // 情况 1：已是 cutout RawImage（直接绘制缩放到原尺寸）
      else if (out?.kind === 'cutout') {
        onProgress?.('composite', 90)
        resultDataUrl = toCanvasDataUrl(out.image, image.width, image.height)
      }
      // 情况 2：存在 mask，用 mask 合成
      else if (out?.kind === 'mask') {
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
        const maskCanvas = typeof maskRI?.toCanvas === 'function' ? maskRI.toCanvas() : asDrawable(maskRI)?.drawable
        if (!maskCanvas) throw new Error('Mask output not drawable')
        // 将 mask 绘制到同尺寸临时画布再读取灰度作为 alpha
        const m = document.createElement('canvas')
        m.width = image.width
        m.height = image.height
        const mctx = m.getContext('2d')!
        const mdraw = asDrawable(maskCanvas)
        if (mdraw) {
          mctx.drawImage(mdraw.drawable, 0, 0, mdraw.width, mdraw.height, 0, 0, image.width, image.height)
        } else {
          // 已经是 canvas
          mctx.drawImage(maskCanvas as CanvasImageSource, 0, 0, (maskCanvas as any).width ?? image.width, (maskCanvas as any).height ?? image.height, 0, 0, image.width, image.height)
        }
        const maskData = mctx.getImageData(0, 0, image.width, image.height).data
        for (let i = 0; i < image.width * image.height; i++) {
          // 使用 mask 的红通道作为 alpha（mask 是灰度）
          pixelData.data[4 * i + 3] = maskData[4 * i] ?? 0
        }
        ctx.putImageData(pixelData, 0, 0)
        resultDataUrl = canvas.toDataURL('image/png')
      }
      // 情况 3：未知结构，尝试将其视为 RawImage/canvas 处理
      else if (out?.kind === 'unknownCanvasLike') {
        onProgress?.('composite', 90)
        resultDataUrl = toCanvasDataUrl(out.any, image.width, image.height)
      } else {
        // 最终兜底：尝试直接把 rawOut 当作可绘制对象使用（尽量避免 null）
        const draw = asDrawable(rawOut)
        if (draw) {
          onProgress?.('composite', 90)
          resultDataUrl = toCanvasDataUrl(rawOut, image.width, image.height)
        }
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
