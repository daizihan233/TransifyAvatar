// filepath: e:\transify_avatar\composables\useMatting.ts
// AI 抠像（去背景）基于 Transformers.js RMBG-1.4 模型（image-segmentation pipeline）
// 仅在浏览器端加载与运行

import { ref, onMounted } from 'vue'

let pipePromise: Promise<any> | null = null
let initialized = false

async function ensureLoaded() {
    if (initialized && pipePromise) return

    const { pipeline, env } = await import('@huggingface/transformers')

    if ((env as any)?.backends?.onnx?.wasm) {
        ;(env as any).backends.onnx.wasm.proxy = true
    }
    ;(env as any).useBrowserCache = true

    pipePromise = pipeline('image-segmentation', 'briaai/RMBG-1.4')
    initialized = true
}

export type MattingBackend = 'transformers' | 'imgly' | 'chroma'

export interface ChromaOptions {
    color: string
    tolerance?: number
    softness?: number
    minRemoveArea?: number
    minKeepArea?: number
    edgeRadius?: number
    edgeExtraTolerance?: number
    useHsv?: boolean
    despill?: boolean
    autoSample?: boolean
}

// HSV 色彩空间转换辅助函数
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255
    g /= 255
    b /= 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min

    let h = 0
    if (delta !== 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6)
        else if (max === g) h = 60 * ((b - r) / delta + 2)
        else h = 60 * ((r - g) / delta + 4)
    }
    if (h < 0) h += 360

    const s = max === 0 ? 0 : delta / max

    return [h, s, max]
}

function hsvDistance(h1: number, s1: number, v1: number, h2: number, s2: number, v2: number): number {
    // 色相是圆形的，需要特殊处理
    let dh = Math.abs(h1 - h2)
    if (dh > 180) dh = 360 - dh
    // 归一化到 0-1 范围
    dh = dh / 180
    const ds = Math.abs(s1 - s2)
    const dv = Math.abs(v1 - v2)
    // 加权距离：色相权重更高
    return Math.sqrt(dh * dh * 2 + ds * ds + dv * dv * 0.5)
}

// ============ Chroma Key 抠图（纯色背景） ============
async function removeBackgroundChroma(
    dataUrl: string,
    options: ChromaOptions,
    onProgress?: (stage: string, percent?: number) => void
): Promise<string> {
    onProgress?.('reading image', 20)

    const hex = options.color || '#00ff00'
    const tol = Math.max(0, Math.min(255, Math.round(options.tolerance ?? 40)))
    const soft = Math.max(0, Math.min(255, Math.round(options.softness ?? 20)))
    const minRemoveArea = Math.max(0, Math.round(options.minRemoveArea ?? 64))
    const minKeepArea = Math.max(0, Math.round(options.minKeepArea ?? 36))
    const edgeRadius = Math.max(0, Math.round(options.edgeRadius ?? 2))
    const edgeExtraTol = Math.max(0, Math.min(255, Math.round(options.edgeExtraTolerance ?? 15)))
    const useHsv = options.useHsv ?? true
    const despill = options.despill ?? true
    const autoSample = options.autoSample ?? false

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

    let [tr, tg, tb] = parseHex(hex)

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

    // 自动采样背景色（从四角和边缘中心点取平均）
    if (autoSample) {
        const samplePoints: Array<[number, number]> = [
            [0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1],
            [Math.floor(w / 2), 0], [Math.floor(w / 2), h - 1],
            [0, Math.floor(h / 2)], [w - 1, Math.floor(h / 2)]
        ]
        let sumR = 0, sumG = 0, sumB = 0, count = 0
        for (const [x, y] of samplePoints) {
            const idx = (y * w + x) * 4
            sumR += data[idx] ?? 0
            sumG += data[idx + 1] ?? 0
            sumB += data[idx + 2] ?? 0
            count++
        }
        tr = Math.round(sumR / count)
        tg = Math.round(sumG / count)
        tb = Math.round(sumB / count)
    }

    // 计算目标颜色的 HSV（如果使用 HSV 模式）
    const [th, ts, tv] = useHsv ? rgbToHsv(tr, tg, tb) : [0, 0, 0]

    // 计算阈值
    const tolLo = useHsv ? tol / 255 : tol
    const tolHi = useHsv ? (tol + soft) / 255 : tol + soft
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

        let dist: number
        if (useHsv) {
            const [h, s, v] = rgbToHsv(r, g, b)
            dist = hsvDistance(h, s, v, th, ts, tv)
        } else {
            const dr = r - tr
            const dg = g - tg
            const db = b - tb
            dist = Math.hypot(dr, dg, db)
        }

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
    const removeMask = new Uint8Array(n)
    const keepMask = new Uint8Array(n)
    const removeThresh = 10
    const keepThresh = 245
    for (let p = 0; p < n; p++) {
        const ap = alpha[p] ?? 0
        removeMask[p] = ap <= removeThresh ? 1 : 0
        keepMask[p] = ap >= keepThresh ? 1 : 0
    }

    const visited = new Uint8Array(n)

    const processComponents = (mask: Uint8Array, minArea: number, onSmall: (idx: number) => void) => {
        visited.fill(0)
        for (let p = 0; p < n; p++) {
            if (!mask[p] || visited[p]) continue
            const q: number[] = [p]
            visited[p] = 1
            const comp: number[] = []
            while (q.length) {
                const cur = q.shift()!
                comp.push(cur)
                const x = cur % w
                if (x > 0) {
                    const nb = cur - 1
                    if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
                }
                if (x + 1 < w) {
                    const nb = cur + 1
                    if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
                }
                if (cur >= w) {
                    const nb = cur - w
                    if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
                }
                if (cur + w < n) {
                    const nb = cur + w
                    if (mask[nb] && !visited[nb]) { visited[nb] = 1; q.push(nb) }
                }
            }
            if (comp.length < minArea) {
                for (const idx of comp) onSmall(idx)
            }
        }
    }

    if (minRemoveArea > 0) {
        processComponents(removeMask, minRemoveArea, (idx) => {
            const a0 = origA[idx] ?? 255
            alpha[idx] = a0
            removeMask[idx] = 0
            if (a0 >= keepThresh) keepMask[idx] = 1
        })
    }

    if (minKeepArea > 0) {
        processComponents(keepMask, minKeepArea, (idx) => {
            alpha[idx] = 0
            keepMask[idx] = 0
            removeMask[idx] = 1
        })
    }

    // 改进的边缘处理
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

        const edgeDilated = new Uint8Array(n)
        for (let p = 0; p < n; p++) {
            if (!edge[p]) continue
            const x = p % w
            const y = (p - (p % w)) / w
            for (let dy = -edgeRadius; dy <= edgeRadius; dy++) {
                for (let dx = -edgeRadius; dx <= edgeRadius; dx++) {
                    const nx = x + dx
                    const ny = y + dy
                    if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
                        edgeDilated[ny * w + nx] = 1
                    }
                }
            }
        }

        const tolLoEdge = useHsv ? Math.min(2, tolLo + edgeExtraTol / 255) : Math.min(255, tolLo + edgeExtraTol)
        const tolHiEdge = useHsv ? Math.min(2, tolLoEdge + soft / 255) : Math.min(255, tolLoEdge + soft)

        for (let p = 0; p < n; p++) {
            if (!edgeDilated[p]) continue
            const a0 = origA[p] ?? 255
            const d = distArr[p] ?? 0
            let aEdge: number
            if (d <= tolLoEdge) {
                aEdge = 0
            } else if (soft > 0 && d < tolHiEdge) {
                aEdge = Math.round(a0 * (d - tolLoEdge) / (tolHiEdge - tolLoEdge))
            } else {
                aEdge = a0
            }
            if (aEdge < (alpha[p] ?? 255)) alpha[p] = aEdge
        }
    }

    // 溢色去除
    if (despill) {
        onProgress?.('despill', 85)
        const isGreen = tg > tr && tg > tb
        const isBlue = tb > tr && tb > tg

        for (let p = 0, i = 0; p < n; p++, i += 4) {
            const a = alpha[p] ?? 0
            if (a < 10) continue

            const r = data[i] ?? 0
            let g = data[i + 1] ?? 0
            let b = data[i + 2] ?? 0

            if (isGreen && g > r && g > b) {
                const limit = (r + b) / 2
                if (g > limit) {
                    const spillAmount = g - limit
                    g = Math.round(limit + spillAmount * 0.3)
                    data[i + 1] = g
                }
            } else if (isBlue && b > r && b > g) {
                const limit = (r + g) / 2
                if (b > limit) {
                    const spillAmount = b - limit
                    b = Math.round(limit + spillAmount * 0.3)
                    data[i + 2] = b
                }
            }
        }
    }

    // 将 alpha 写回像素
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        data[i + 3] = alpha[p] ?? 0
    }

    onProgress?.('composite', 90)
    ctx.putImageData(id, 0, 0)
    const out = canvas.toDataURL('image/png')
    onProgress?.('done', 100)
    return out
}

// ============ ImgLy 背景移除 ============
async function removeBackgroundImgly(
    dataUrl: string,
    onProgress?: (stage: string, percent?: number) => void
): Promise<string> {
    onProgress?.('loading model', 10)
    let removeBackground: any
    try {
        // @ts-ignore
        ({ removeBackground } = await import('@imgly/background-removal'))
    } catch {
        throw new Error('请先安装依赖：@imgly/background-removal')
    }
    onProgress?.('reading image', 30)
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

// ============ Transformers RMBG 抠图 ============
async function removeBackgroundTransformers(
    dataUrl: string,
    onProgress?: (stage: string, percent?: number) => void
): Promise<string> {
    onProgress?.('loading model', 10)
    await ensureLoaded()
    const pipe = await pipePromise!
    onProgress?.('model ready', 20)

    const { RawImage } = await import('@huggingface/transformers')
    onProgress?.('reading image', 30)
    const image = await RawImage.fromURL(dataUrl)

    onProgress?.('infer', 70)
    const rawOut = await pipe(image)

    const asDrawable = (src: any): { drawable: CanvasImageSource, width: number, height: number } | null => {
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

// ============ 主导出函数 ============
export function useMatting() {
    const loading = ref(false)
    const error = ref<string | null>(null)

    onMounted(async () => {
        try {
            await ensureLoaded()
        } catch (e) {
            console.error('Failed to load matting model:', e)
        }
    })

    const removeBg = async (
        dataUrl: string,
        onProgress?: (stage: string, percent?: number) => void,
        options?: {
            backend?: MattingBackend
            chroma?: ChromaOptions
        }
    ): Promise<string> => {

        if (!dataUrl) throw new Error('No image provided')
        loading.value = true
        error.value = null

        try {
            if (!initialized) {
                await ensureLoaded()
            }

            const backend: MattingBackend = options?.backend ?? 'transformers'

            if (backend === 'chroma') {
                if (!options?.chroma) {
                    throw new Error('Chroma options are required for chroma backend')
                }
                return await removeBackgroundChroma(dataUrl, options.chroma, onProgress)
            }

            if (backend === 'imgly') {
                return await removeBackgroundImgly(dataUrl, onProgress)
            }

            return await removeBackgroundTransformers(dataUrl, onProgress)
        } catch (e: any) {
            error.value = e?.message || String(e)
            throw e
        } finally {
            loading.value = false
        }
    }

    return { removeBg, loading, error }
}