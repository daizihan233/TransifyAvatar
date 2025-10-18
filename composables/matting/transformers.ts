// Transformers RMBG 抠图

let pipePromise: Promise<any> | null = null
let initialized = false

/**
 * 确保模型已加载
 */
export async function ensureLoaded() {
  // 🔧 关键修复：确保只在客户端环境中运行
  if (typeof window === 'undefined') {
    throw new Error('Transformers.js 只能在客户端环境中运行')
  }

  if (initialized && pipePromise) return

  try {
    console.log('[Transformers] 初始化环境配置...')

    // 动态导入，确保不会在服务端执行
    const { pipeline, env } = await import('@huggingface/transformers')

    // 🔧 完全重写后端配置，避免使用本地 onnxruntime 模块
    // 直接从 CDN 加载所有内容
    ;(env as any).backends = {
      onnx: {
        wasm: {
          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/',
        },
      },
    }

    // 全局配置
    ;(env as any).useBrowserCache = true
    ;(env as any).allowLocalModels = false
    ;(env as any).allowRemoteModels = true

    console.log('[Transformers] WASM 配置:', (env as any).backends.onnx.wasm)
    console.log('[Transformers] 开始加载模型...')

    pipePromise = pipeline('image-segmentation', 'briaai/RMBG-1.4', {
      device: 'wasm',
      dtype: 'fp32',
    })

    initialized = true
    console.log('[Transformers] 模型初始化成功')
  } catch (error) {
    console.error('[Transformers] 初始化失败:', error)
    initialized = false
    pipePromise = null
    throw new Error(`模型加载失败: ${error instanceof Error ? error.message : '未知错误'}`)
  }
}

/**
 * 使用 Transformers RMBG 模型进行背景移除
 */
export async function removeBackgroundTransformers(
  dataUrl: string,
  onProgress?: (stage: string, percent?: number) => void
): Promise<string> {
  // 🔧 客户端检查
  if (typeof window === 'undefined') {
    throw new Error('此功能只能在浏览器中使用')
  }

  onProgress?.('loading model', 10)
  await ensureLoaded()
  const pipe = await pipePromise!
  onProgress?.('model ready', 20)

  const { RawImage } = await import('@huggingface/transformers')
  onProgress?.('reading image', 30)
  const image = await RawImage.fromURL(dataUrl)

  onProgress?.('infer', 70)
  const rawOut = await pipe(image)

  const asDrawable = (src: any): { drawable: CanvasImageSource; width: number; height: number } | null => {
    try {
      if (!src) return null
      if (typeof src?.toCanvas === 'function' && typeof src?.width === 'number' && typeof src?.height === 'number') {
        const c = src.toCanvas()
        return { drawable: c, width: src.width, height: src.height }
      }
      if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) {
        return { drawable: src, width: src.width, height: src.height }
      }
      if (typeof OffscreenCanvas !== 'undefined' && src instanceof OffscreenCanvas) {
        // @ts-ignore
        return { drawable: src as unknown as CanvasImageSource, width: (src as any).width, height: (src as any).height }
      }
      if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) {
        return { drawable: src, width: src.width, height: src.height }
      }
      if (typeof Image !== 'undefined' && src instanceof Image) {
        return { drawable: src, width: src.naturalWidth || src.width, height: src.naturalHeight || src.height }
      }
      if (src?.canvas && typeof src.canvas?.toDataURL === 'function') {
        const c = src.canvas as HTMLCanvasElement
        return { drawable: c, width: c.width, height: c.height }
      }
      return null
    } catch {
      return null
    }
  }

  type Normalized =
    | { kind: 'dataurl'; data: string }
    | { kind: 'cutout'; image: any }
    | { kind: 'mask'; mask: any }
    | { kind: 'unknownCanvasLike'; any: any }
    | null

  const normalizeOutput = (out: any): Normalized => {
    if (typeof out === 'string' && out.startsWith('data:')) {
      return { kind: 'dataurl', data: out }
    }

    if (Array.isArray(out)) {
      for (const item of out) {
        if (!item) continue
        if (typeof (item as any)?.startsWith === 'function' && (item as any).startsWith('data:')) {
          return { kind: 'dataurl', data: item as unknown as string }
        }
        if (typeof (item as any)?.toCanvas === 'function') {
          return { kind: 'cutout', image: item }
        }
        if ((item as any)?.image && typeof (item as any).image?.toCanvas === 'function') {
          return { kind: 'cutout', image: (item as any).image }
        }
        if ((item as any)?.mask && typeof (item as any).mask?.toCanvas === 'function') {
          return { kind: 'mask', mask: (item as any).mask }
        }
        const draw = asDrawable(item)
        if (draw) return { kind: 'unknownCanvasLike', any: item }
      }
      const first = out[0]
      const draw = asDrawable(first)
      if (draw) return { kind: 'unknownCanvasLike', any: first }
      return null
    }

    if (out && typeof out.toCanvas === 'function' && typeof out.width === 'number') {
      return { kind: 'cutout', image: out }
    }
    if (out?.image && typeof out.image?.toCanvas === 'function') {
      return { kind: 'cutout', image: out.image }
    }
    if (out?.mask && typeof out.mask?.toCanvas === 'function') {
      return { kind: 'mask', mask: out.mask }
    }
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
  } else if (out?.kind === 'cutout') {
    onProgress?.('composite', 90)
    resultDataUrl = toCanvasDataUrl(out.image, image.width, image.height)
  } else if (out?.kind === 'mask') {
    onProgress?.('resize mask', 80)
    const maskRI = out.mask
    onProgress?.('composite', 90)
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image.toCanvas(), 0, 0)

    const pixelData = ctx.getImageData(0, 0, image.width, image.height)
    const maskCanvas = typeof maskRI?.toCanvas === 'function' ? maskRI.toCanvas() : asDrawable(maskRI)?.drawable
    if (!maskCanvas) throw new Error('Mask output not drawable')
    const m = document.createElement('canvas')
    m.width = image.width
    m.height = image.height
    const mctx = m.getContext('2d')!
    const mdraw = asDrawable(maskCanvas)
    if (mdraw) {
      mctx.drawImage(mdraw.drawable, 0, 0, mdraw.width, mdraw.height, 0, 0, image.width, image.height)
    } else {
      mctx.drawImage(maskCanvas as CanvasImageSource, 0, 0, (maskCanvas as any).width ?? image.width, (maskCanvas as any).height ?? image.height, 0, 0, image.width, image.height)
    }
    const maskData = mctx.getImageData(0, 0, image.width, image.height).data
    for (let i = 0; i < image.width * image.height; i++) {
      pixelData.data[4 * i + 3] = maskData[4 * i] ?? 0
    }
    ctx.putImageData(pixelData, 0, 0)
    resultDataUrl = canvas.toDataURL('image/png')
  } else if (out?.kind === 'unknownCanvasLike') {
    onProgress?.('composite', 90)
    resultDataUrl = toCanvasDataUrl(out.any, image.width, image.height)
  } else {
    const draw = asDrawable(rawOut)
    if (draw) {
      onProgress?.('composite', 90)
      resultDataUrl = toCanvasDataUrl(rawOut, image.width, image.height)
    }
  }

  if (resultDataUrl === null) throw new Error('Unexpected pipeline output')

  onProgress?.('done', 100)
  return resultDataUrl
}
