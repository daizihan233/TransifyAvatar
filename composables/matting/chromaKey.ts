// Chroma Key 抠图算法（纯色背景抠图）

import { rgbToHsv, hsvDistance, parseHexColor } from './colorUtils'

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

/**
 * Chroma Key 抠图主函数
 */
export async function removeBackgroundChroma(
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

  let [tr, tg, tb] = parseHexColor(hex)

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

  // 自动采样背景色
  if (autoSample) {
    ;[tr, tg, tb] = autoSampleBackgroundColor(data, w, h)
  }

  // 计算目标颜色的 HSV
  const [th, ts, tv] = useHsv ? rgbToHsv(tr, tg, tb) : [0, 0, 0]

  // 计算阈值
  const tolLo = useHsv ? tol / 255 : tol
  const tolHi = useHsv ? (tol + soft) / 255 : tol + soft
  const tolHiClamped = Math.max(tolLo, tolHi)

  onProgress?.('infer', 60)

  // 计算 alpha 通道
  const { origA, alpha, distArr } = computeAlpha(
    data, n, w, h, tr, tg, tb, th, ts, tv,
    useHsv, tolLo, tolHiClamped
  )

  onProgress?.('preprocess', 70)

  // 处理小区域（噪点/小洞）
  processSmallRegions(alpha, origA, w, h, n, minRemoveArea, minKeepArea)

  // 改进的边缘处理
  if (edgeRadius > 0 && edgeExtraTol > 0) {
    processEdges(alpha, origA, distArr, w, h, n, edgeRadius, edgeExtraTol, tolLo, soft, useHsv)
  }

  // 溢色去除
  if (despill) {
    onProgress?.('despill', 85)
    removeDespill(data, alpha, n, tr, tg, tb)
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

/**
 * 自动采样背景色（从四角和边缘中心点）
 */
function autoSampleBackgroundColor(
  data: Uint8ClampedArray,
  w: number,
  h: number
): [number, number, number] {
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
  return [
    Math.round(sumR / count),
    Math.round(sumG / count),
    Math.round(sumB / count)
  ]
}

/**
 * 计算初始 alpha 通道和距离数组
 */
function computeAlpha(
  data: Uint8ClampedArray,
  n: number,
  w: number,
  h: number,
  tr: number, tg: number, tb: number,
  th: number, ts: number, tv: number,
  useHsv: boolean,
  tolLo: number,
  tolHiClamped: number
) {
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
    const soft = tolHiClamped - tolLo
    if (dist <= tolLo) {
      alpha[p] = 0
    } else if (soft > 0 && dist < tolHiClamped) {
      const t = (dist - tolLo) / soft
      alpha[p] = Math.round(a * t)
    } else {
      alpha[p] = a
    }
  }

  return { origA, alpha, distArr }
}

/**
 * 处理小区域（移除噪点和小洞）
 */
function processSmallRegions(
  alpha: Uint8ClampedArray,
  origA: Uint8ClampedArray,
  w: number,
  h: number,
  n: number,
  minRemoveArea: number,
  minKeepArea: number
) {
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
}

/**
 * 边缘处理（羽化）
 */
function processEdges(
  alpha: Uint8ClampedArray,
  origA: Uint8ClampedArray,
  distArr: Float32Array,
  w: number,
  h: number,
  n: number,
  edgeRadius: number,
  edgeExtraTol: number,
  tolLo: number,
  soft: number,
  useHsv: boolean
) {
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
    if (check(x - 1, y) || check(x + 1, y) || check(x, y - 1) || check(x, y + 1)) {
      edge[p] = 1
    }
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

/**
 * 溢色去除（Despill）
 */
function removeDespill(
  data: Uint8ClampedArray,
  alpha: Uint8ClampedArray,
  n: number,
  tr: number,
  tg: number,
  tb: number
) {
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

