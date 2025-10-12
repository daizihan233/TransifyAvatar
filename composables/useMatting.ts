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

export type MattingBackend = 'transformers' | 'imgly' | 'chroma'

export function useMatting() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 输入：裁剪后的 dataURL（PNG/JPEG 均可）
  // 输出：PNG dataURL，带透明通道。
  async function removeBg(
    dataUrl: string,
    onProgress?: (stage: string, percent?: number) => void,
    options?: { backend?: MattingBackend, chroma?: { color: string, tolerance?: number, softness?: number, minRemoveArea?: number, minKeepArea?: number, edgeRadius?: number, edgeExtraTolerance?: number } }
  ): Promise<string> {
    const backend: MattingBackend = options?.backend ?? 'transformers'

    if (!dataUrl) throw new Error('No image provided')
    loading.value = true
    error.value = null
    try {
      if (backend === 'chroma') {
        // 纯色抠图（按用户选择的颜色去除背景）
        onProgress?.('reading image', 20)

        // 解析颜色为 RGB
        const hex = options?.chroma?.color || '#00ff00'
        const tol = Math.max(0, Math.min(255, Math.round(options?.chroma?.tolerance ?? 40)))
        const soft = Math.max(0, Math.min(255, Math.round(options?.chroma?.softness ?? 20)))
        const minRemoveArea = Math.max(0, Math.round(options?.chroma?.minRemoveArea ?? 64))
        const minKeepArea = Math.max(0, Math.round(options?.chroma?.minKeepArea ?? 36))
        const edgeRadius = Math.max(0, Math.round(options?.chroma?.edgeRadius ?? 2))
        const edgeExtraTol = Math.max(0, Math.min(255, Math.round(options?.chroma?.edgeExtraTolerance ?? 15)))

        const parseHex = (c: string): [number, number, number] => {
          const s = c.trim().toLowerCase()
          const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s)
          if (!m) return [0, 255, 0]
          const v = m[1]!
          if (v.length === 3) {
            const r = Number.parseInt(v.charAt(0) + v.charAt(0), 16)
            const g = Number.parseInt(v.charAt(1) + v.charAt(1), 16)
            const b = Number.parseInt(v.charAt(2) + v.charAt(2), 16)
            return [r, g, b]
          }
          const r = Number.parseInt(v.slice(0, 2), 16)
          const g = Number.parseInt(v.slice(2, 4), 16)
          const b = Number.parseInt(v.slice(4, 6), 16)
          return [r, g, b]
        }

        const [tr, tg, tb] = parseHex(hex)

        // 加载图片到画布
        const img = new Image()
        const loaded: Promise<HTMLImageElement> = new Promise((resolve, reject) => {
          img.onload = () => resolve(img)
          img.onerror = () => reject(new Error('无法读取图片'))
        })
        img.src = dataUrl
        await loaded

        onProgress?.('preprocess', 40)
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, img.naturalWidth || img.width)
        canvas.height = Math.max(1, img.naturalHeight || img.height)
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

        const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const data = id.data
        const w = canvas.width
        const h = canvas.height
        const n = w * h

        // 计算阈值：使用 RGB 空间欧氏距离（0..~441）。
        // 这里以单通道最大差值为 255 标准化，容差参数按 0..255 解读。
        const tolLo = tol
        const tolHi = tol + soft
        const tolHiClamped = Math.max(tolLo, tolHi)

        onProgress?.('infer', 60)
        // 先计算初始 alpha 与距离，保留原始 alpha
        const origA = new Uint8ClampedArray(n)
        const alpha = new Uint8ClampedArray(n)
        const distArr = new Float32Array(n)
        for (let p = 0, i = 0; p < n; p++, i += 4) {
          const r = data[i] ?? 0
          const g = data[i + 1] ?? 0
          const b = data[i + 2] ?? 0
          const a = data[i + 3] ?? 255
          origA[p] = a
          const dr = r - tr
          const dg = g - tg
          const db = b - tb
          const dist = Math.hypot(dr, dg, db)
          distArr[p] = dist
          if (dist <= tolLo) {
            alpha[p] = 0
          } else if (soft > 0 && dist < tolHiClamped) {
            const t = (dist - tolLo) / (tolHiClamped - tolLo)
            alpha[p] = Math.round(a * t)
          } else {
            alpha[p] = a
          }
        }

        // 基于连通域进行小区域抑制（噪点/小洞）
        onProgress?.('preprocess', 70)
        const removeMask = new Uint8Array(n) // 1 表示移除（背景），0 保留
        const keepMask = new Uint8Array(n) // 1 表示保留（前景），0 移除
        const removeThresh = 10
        const keepThresh = 245
        for (let p = 0; p < n; p++) {
          const ap = alpha[p] ?? 0
          removeMask[p] = ap <= removeThresh ? 1 : 0
          keepMask[p] = ap >= keepThresh ? 1 : 0
        }

        const visited = new Uint8Array(n)

        // helper: process components on a mask
        const processComponents = (mask: Uint8Array, minArea: number, onSmall: (idx: number) => void) => {
          visited.fill(0)
          for (let p = 0; p < n; p++) {
            if (!mask[p] || visited[p]) continue
            // BFS
            const q: number[] = [p]
            visited[p] = 1
            const comp: number[] = []
            while (q.length) {
              const cur = q.shift()!
              comp.push(cur)
              const x = cur % w
              // left
              if (x > 0) {
                const nb = cur - 1
                if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
              }
              // right
              if (x + 1 < w) {
                const nb = cur + 1
                if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
              }
              // up
              if (cur >= w) {
                const nb = cur - w
                if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
              }
              // down
              if (cur + w < n) {
                const nb = cur + w
                if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
              }
            }
            if (comp.length < minArea) {
              // too small
              for (const idx of comp) onSmall(idx)
            }
          }
        }

        // 1) 小的“将被移除”区域：保留它们（避免小洞被抠掉）
        if (minRemoveArea > 0) {
          processComponents(removeMask, minRemoveArea, (idx) => {
            // revert to keep
            const a0 = origA[idx] ?? 255
            alpha[idx] = a0
            removeMask[idx] = 0
            if (a0 >= keepThresh) keepMask[idx] = 1
          })
        }

        // 2) 小的“保留”孤立区域：去除它们（消除小碎片）
        if (minKeepArea > 0) {
          processComponents(keepMask, minKeepArea, (idx) => {
            alpha[idx] = 0
            keepMask[idx] = 0
            removeMask[idx] = 1
          })
        }

        // 3) 仅在边缘扩大容差：找到前景边缘，膨胀 edgeRadius，再基于更大容差重算局部 alpha 并取更小值
        if (edgeRadius > 0 && edgeExtraTol > 0) {
          const edge = new Uint8Array(n)
          const thrKeep = 180
          const thrRem = 75
          for (let p = 0; p < n; p++) {
            const a = alpha[p] ?? 0
            const isKeep = a >= thrKeep
            if (!isKeep) continue
            const x = p % w
            const y = (p - x) / w
            const check = (xx: number, yy: number) => {
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false
              const q = yy * w + xx
              return (alpha[q] ?? 255) <= thrRem
            }
            if (check(x - 1, y) || check(x + 1, y) || check(x, y - 1) || check(x, y + 1)) edge[p] = 1
          }
          // 膨胀 edge -> edgeDilated
          const edgeDilated = new Uint8Array(n)
          if (edgeRadius === 1) {
            for (let p = 0; p < n; p++) if (edge[p]) {
              const x = p % w, y = (p - (p % w)) / w
              edgeDilated[p] = 1
              if (x > 0) edgeDilated[p - 1] = 1
              if (x + 1 < w) edgeDilated[p + 1] = 1
              if (y > 0) edgeDilated[p - w] = 1
              if (y + 1 < h) edgeDilated[p + w] = 1
            }
          } else {
            // 简单的多次扩张（radius 次 4-邻域膨胀）
            let cur = edge, next = edgeDilated
            // 初始化 next = cur
            next.set(cur)
            for (let r = 0; r < edgeRadius; r++) {
              for (let p = 0; p < n; p++) if (cur[p]) {
                const x = p % w, y = (p - (p % w)) / w
                next[p] = 1
                if (x > 0) next[p - 1] = 1
                if (x + 1 < w) next[p + 1] = 1
                if (y > 0) next[p - w] = 1
                if (y + 1 < h) next[p + w] = 1
              }
              // 交换缓冲
              if (r < edgeRadius - 1) {
                cur = new Uint8Array(next)
              }
            }
          }

          const tolLoEdge = Math.min(255, tolLo + edgeExtraTol)
          const tolHiEdge = Math.min(255, tolLoEdge + soft)
          for (let p = 0; p < n; p++) {
            if (!edgeDilated[p]) continue
            const a0 = origA[p] ?? 255
            const d = distArr[p] ?? 0
            let aEdge: number
            if (d <= tolLoEdge) aEdge = 0
            else if (soft > 0 && d < tolHiEdge) aEdge = Math.round(a0 * (d - tolLoEdge) / (tolHiEdge - tolLoEdge))
            else aEdge = a0
            if (aEdge < (alpha[p] ?? 255)) alpha[p] = aEdge
          }
        }

        // 将 alpha 写回像素
        for (let p = 0, i = 0; p < n; p++, i += 4) {
          data[i + 3] = (alpha[p] ?? 0)
        }

        onProgress?.('composite', 90)
        ctx.putImageData(id, 0, 0)
        const out = canvas.toDataURL('image/png')
        onProgress?.('done', 100)
        return out
      }

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
