// Chroma Key 抠图算法 - 动漫图优化版 v4
// 增强毛边处理 + 边缘羽化 + 抗锯齿

import { rgbToHsv, hsvDistance, parseHexColor } from './colorUtils'

export interface ChromaAnimeOptions {
    color: string
    tolerance?: number
    minKeepArea?: number
    useHsv?: boolean
    autoSample?: boolean
    edgeThreshold?: number        // 0 = 禁用边缘检测
    erosionTolerance?: number     // 0 = 禁用边缘腐蚀
    floodFillStrength?: number    // -1 = 禁用洪水填充
    complexStructureThreshold?: number  // 0 = 禁用复杂结构保护
    edgePrecision?: number        // 相关到边缘腐蚀，当 erosionTolerance=0 时也无效
    minEnclosedArea?: number      // 0 = 禁用封闭区域检测，9999 = 处理所有封闭区域

    // 🆕 新增参数：边缘羽化和抗锯齿
    edgeFeather?: number          // 边缘羽化强度 (0-5，0=禁用，默认2)
    antiAlias?: boolean           // 是否启用抗锯齿 (默认true)
    aggressiveEdgeRemoval?: boolean // 激进的毛边移除模式 (默认false)

    // 🔧 边缘复杂度分析参数（高级）
    complexityWeights?: {
        angleChange?: number        // 平均角度变化权重 (默认35)
        stdDev?: number            // 标准差权重 (默认35)
        perimeterArea?: number     // 周长面积比权重 (默认20)
        circularity?: number       // 圆形度权重 (默认10)
    }
    maxEnclosedAreaForComplexity?: number  // 面积大于此值时不进行复杂度分析，直接保持透明 (默认9999=不限制)
    perimeterAreaNormalizer?: number       // 周长面积比归一化系数 (默认10)
}

/**
 * 动漫图 Chroma Key 抠图（v4 - 增强毛边处理）
 */
export async function removeBackgroundChromaAnime(
    dataUrl: string,
    options: ChromaAnimeOptions,
    onProgress?: (stage: string, percent?: number) => void
): Promise<string> {
    onProgress?.('🔍 读取图片...', 10)
    await nextFrame() // 让出主线程

    const hex = options.color || '#00ff00'
    // 直接使用前端传入的值，不进行任何校验
    const tol = options.tolerance ?? 40
    const minKeepArea = options.minKeepArea ?? 100
    const useHsv = options.useHsv ?? true
    const autoSample = options.autoSample ?? false
    const edgeThreshold = options.edgeThreshold ?? 30
    const erosionTolerance = options.erosionTolerance ?? 1.5
    const floodFillStrength = options.floodFillStrength ?? 0.5
    const complexStructureThreshold = options.complexStructureThreshold ?? 3
    const edgePrecision = options.edgePrecision ?? 2
    const minEnclosedArea = options.minEnclosedArea ?? 100
    const aggressiveEdgeRemoval = options.aggressiveEdgeRemoval ?? false
    const edgeFeather = options.edgeFeather ?? 2
    const antiAlias = options.antiAlias ?? true

    // 读取边缘复杂度分析参数 - 直接使用
    const complexityWeights = {
        angleChange: options.complexityWeights?.angleChange ?? 35,
        stdDev: options.complexityWeights?.stdDev ?? 35,
        perimeterArea: options.complexityWeights?.perimeterArea ?? 20,
        circularity: options.complexityWeights?.circularity ?? 10
    }
    const maxEnclosedAreaForComplexity = options.maxEnclosedAreaForComplexity ?? 9999
    const perimeterAreaNormalizer = options.perimeterAreaNormalizer ?? 10

    let [tr, tg, tb] = parseHexColor(hex)

    onProgress?.('📷 加载图片数据...', 20)
    await nextFrame()

    const img = new Image()
    const loaded: Promise<HTMLImageElement> = new Promise((resolve, reject) => {
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('无法读取图片'))
    })
    img.src = dataUrl
    await loaded

    onProgress?.('🎨 初始化画布...', 30)
    await nextFrame()

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

    if (autoSample) {
        onProgress?.('🎯 自动采样背景色...', 35)
        await nextFrame()
        ;[tr, tg, tb] = autoSampleBackgroundColor(data, w, h)
    }

    const [th, ts, tv] = useHsv ? rgbToHsv(tr, tg, tb) : [0, 0, 0]

    onProgress?.('🔬 Step 1/6: 标记背景像素...', 40)
    await nextFrame()

    // Step 1: 保守标记背景（只标记非常确定的背景）
    const bgMask = new Uint8Array(n)
    const distArr = await conservativeMarkBackground(data, bgMask, w, h, n, { r: tr, g: tg, b: tb, h: th, s: ts, v: tv }, useHsv, tol)

    // Step 2: 边缘检测（edgeThreshold = 0 时禁用）
    let edgeMask = new Uint8Array(n)
    if (edgeThreshold > 0) {
        onProgress?.('🔍 Step 2/6: 检测图像边缘...', 50)
        await nextFrame()
        edgeMask = await detectSharpEdges(data, w, h, n, edgeThreshold)
        console.log(`✅ [Step 2] 边缘检测已启用 (阈值: ${edgeThreshold})`)
    } else {
        onProgress?.('⏭️ Step 2/6: 跳过边缘检测', 50)
        await nextFrame()
        console.log('⚠️ [Step 2] 边缘检测已禁用 (阈值=0)')
    }

    // Step 3: 保守洪水填充（floodFillStrength = -1 时禁用）
    if (floodFillStrength >= 0) {
        onProgress?.('💧 Step 3/6: 洪水填充背景...', 55)
        await nextFrame()
        await conservativeFloodFill(bgMask, edgeMask, distArr, w, h, { n, tolThreshold: useHsv ? tol / 255 : tol, floodFillStrength })
        console.log(`✅ [Step 3] 洪水填充已启用 (强度: ${floodFillStrength.toFixed(1)})`)
    } else {
        onProgress?.('⏭️ Step 3/6: 跳过洪水填充', 55)
        await nextFrame()
        console.log('⚠️ [Step 3] 洪水填充已禁用 (强度=-1)')
    }

    // Step 3.5: 识别并保护复杂结构（complexStructureThreshold = 0 或 minEnclosedArea = 0 时禁用）
    if (complexStructureThreshold > 0 && minEnclosedArea > 0) {
        onProgress?.('🧩 Step 4/6: 分析复杂结构...', 60)
        await nextFrame()
        await protectComplexStructures(bgMask, w, h, n, complexStructureThreshold, minEnclosedArea, edgeMask, distArr, useHsv ? tol / 255 : tol, complexityWeights, maxEnclosedAreaForComplexity, perimeterAreaNormalizer)
        console.log(`✅ [Step 3.5] 复杂结构保护已启用 (复杂度阈值: ${complexStructureThreshold}, 最小面积: ${minEnclosedArea})`)
    } else {
        onProgress?.('⏭️ Step 4/6: 跳过复杂结构分析', 60)
        await nextFrame()
        console.log('⚠️ [Step 3.5] 复杂结构保护已禁用 (阈值=0 或 最小面积=0)')
    }

    // Step 4: 移除小噪点（minKeepArea = 0 时禁用）
    if (minKeepArea > 0) {
        onProgress?.('🧹 清理小噪点...', 70)
        await nextFrame()
        await removeSmallForegroundRegions(bgMask, w, h, n, minKeepArea)
        console.log(`✅ [Step 4] 小区域移除已启用 (最小面积: ${minKeepArea})`)
    } else {
        onProgress?.('⏭️ 跳过小噪点清理', 70)
        await nextFrame()
        console.log('⚠️ [Step 4] 小区域移除已禁用 (最小面积=0)')
    }

    // Step 5: 精确边缘定位 + 激进腐蚀（erosionTolerance = 0 时禁用）
    if (erosionTolerance > 0) {
        onProgress?.(`✂️ Step 5/6: 去除毛边${aggressiveEdgeRemoval ? ' (激进模式)' : ''}...`, 75)
        await nextFrame()
        await preciseEdgeErosion(bgMask, data, w, h, n, { r: tr, g: tg, b: tb, h: th, s: ts, v: tv }, useHsv, tol, erosionTolerance, edgePrecision, aggressiveEdgeRemoval)
        console.log(`✅ [Step 5] 边缘腐蚀已启用 (强度: ${erosionTolerance.toFixed(1)}, 精度: ${edgePrecision}, 激进模式: ${aggressiveEdgeRemoval})`)
    } else {
        onProgress?.('⏭️ Step 5/6: 跳过毛边去除', 75)
        await nextFrame()
        console.log('⚠️ [Step 5] 边缘腐蚀已禁用 (强度=0)')
    }

    // 🆕 Step 6: 边缘羽化和抗锯齿
    const alphaMap = new Uint8Array(n)
    alphaMap.fill(255) // 默认完全不透明

    if (edgeFeather > 0 || antiAlias) {
        onProgress?.('✨ Step 6/6: 优化边缘效果...', 85)
        await nextFrame()
        await applyEdgeFeatheringAndAntiAlias(bgMask, alphaMap, data, distArr, w, h, n, { r: tr, g: tg, b: tb, h: th, s: ts, v: tv }, useHsv, tol, edgeFeather, antiAlias)
        console.log(`✅ [Step 6] 边缘优化已启用 (羽化: ${edgeFeather}, 抗锯齿: ${antiAlias})`)
    } else {
        onProgress?.('⏭️ Step 6/6: 跳过边缘优化', 85)
        await nextFrame()
        console.log('⚠️ [Step 6] 边缘优化已禁用')
    }

    onProgress?.('🎭 合成最终图像...', 90)
    await nextFrame()

    // 应用透明度 - 分批处理避免阻塞
    const chunkSize = 50000
    for (let start = 0; start < n; start += chunkSize) {
        const end = Math.min(start + chunkSize, n)
        for (let p = start, i = start * 4; p < end; p++, i += 4) {
            if (bgMask[p]) {
                data[i + 3] = 0
            } else {
                data[i + 3] = alphaMap[p]
            }
        }
        if (end < n) await nextFrame() // 每处理一批就让出主线程
    }

    onProgress?.('💾 生成PNG图片...', 95)
    await nextFrame()
    ctx.putImageData(id, 0, 0)
    const out = canvas.toDataURL('image/png')

    onProgress?.('✅ 完成！', 100)
    return out
}

// 🆕 辅助函数：让出主线程，允许UI更新
function nextFrame(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

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
 * 保守标记背景（只标记非常确定是背景的像素）
 */
async function conservativeMarkBackground(
  data: Uint8ClampedArray,
  bgMask: Uint8Array,
  w: number,
  h: number,
  n: number,
  targetColor: { r: number, g: number, b: number, h: number, s: number, v: number },
  useHsv: boolean,
  tol: number
): Promise<Float32Array> {
  const distArr = new Float32Array(n)
  const strictThreshold = useHsv ? (tol * 0.7) / 255 : tol * 0.7
  const chunkSize = 50000

  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(start + chunkSize, n)
    for (let p = start, i = start * 4; p < end; p++, i += 4) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0

      let dist: number
      if (useHsv) {
        const [h, s, v] = rgbToHsv(r, g, b)
        dist = hsvDistance(h, s, v, targetColor.h, targetColor.s, targetColor.v)
      } else {
        const dr = r - targetColor.r
        const dg = g - targetColor.g
        const db = b - targetColor.b
        dist = Math.hypot(dr, dg, db)
      }

      distArr[p] = dist

      if (dist <= strictThreshold) {
        bgMask[p] = 1
      }
    }
    if (end < n) await nextFrame()
  }

  return distArr
}

async function detectSharpEdges(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  n: number,
  edgeThreshold: number
): Promise<Uint8Array> {
  const edgeMask = new Uint8Array(n)
  const chunkSize = 10000

  for (let start = 0; start < n; start += chunkSize) {
    const end = Math.min(start + chunkSize, n)
    for (let p = start; p < end; p++) {
      const x = p % w
      const y = Math.floor(p / w)

      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) continue

      const i = p * 4
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0

      let maxDiff = 0

      const checkNeighbor = (nx: number, ny: number) => {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
        const ni = (ny * w + nx) * 4
        const nr = data[ni] ?? 0
        const ng = data[ni + 1] ?? 0
        const nb = data[ni + 2] ?? 0
        const diff = Math.abs(r - nr) + Math.abs(g - ng) + Math.abs(b - nb)
        maxDiff = Math.max(maxDiff, diff)
      }

      checkNeighbor(x - 1, y)
      checkNeighbor(x + 1, y)
      checkNeighbor(x, y - 1)
      checkNeighbor(x, y + 1)

      if (maxDiff > edgeThreshold) {
        edgeMask[p] = 1
      }
    }
    if (end < n) await nextFrame()
  }

  return edgeMask
}

async function conservativeFloodFill(
  bgMask: Uint8Array,
  edgeMask: Uint8Array,
  distArr: Float32Array,
  w: number,
  h: number,
  params: {
    n: number,
    tolThreshold: number,
    floodFillStrength: number
  }
): Promise<void> {
  const { n, tolThreshold, floodFillStrength } = params
  const visited = new Uint8Array(n)
  const queue: number[] = []

  // 只从图像四边的背景区域开始
  for (let x = 0; x < w; x++) {
    const topPos = x
    const bottomPos = (h - 1) * w + x
    if (!visited[topPos] && bgMask[topPos]) {
      queue.push(topPos)
      visited[topPos] = 1
    }
    if (!visited[bottomPos] && bgMask[bottomPos]) {
      queue.push(bottomPos)
      visited[bottomPos] = 1
    }
  }
  for (let y = 1; y < h - 1; y++) {
    const left = y * w
    const right = y * w + w - 1
    if (!visited[left] && bgMask[left]) {
      queue.push(left)
      visited[left] = 1
    }
    if (!visited[right] && bgMask[right]) {
      queue.push(right)
      visited[right] = 1
    }
  }

  const expandThreshold = tolThreshold * (0.7 + floodFillStrength * 0.3)
  let processedCount = 0

  while (queue.length > 0) {
    const p = queue.shift()!
    const x = p % w
    const y = Math.floor(p / w)

    const tryExpand = (nx: number, ny: number) => {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
      const np = ny * w + nx
      if (visited[np]) return

      const npDist = distArr[np] ?? Infinity
      const isEdge = edgeMask[np]

      if (!bgMask[np]) {
        if (npDist > expandThreshold || isEdge) {
          return
        }
      }

      if (isEdge && npDist > tolThreshold * 0.3) {
        return
      }

      visited[np] = 1
      bgMask[np] = 1
      queue.push(np)
    }

    tryExpand(x - 1, y)
    tryExpand(x + 1, y)
    tryExpand(x, y - 1)
    tryExpand(x, y + 1)

    processedCount++
    if (processedCount % 5000 === 0) {
      await nextFrame()
    }
  }

  let unvisitedBgCount = 0
  for (let p = 0; p < n; p++) {
    if (bgMask[p] && !visited[p]) {
      unvisitedBgCount++
    }
  }
  console.log(`[洪水填充] 保留了 ${unvisitedBgCount} 个未访问的背景像素供后续分析`)
}

async function removeSmallForegroundRegions(
  bgMask: Uint8Array,
  w: number,
  h: number,
  n: number,
  minKeepArea: number
): Promise<void> {
  const visited = new Uint8Array(n)
  const fgMask = new Uint8Array(n)

  for (let p = 0; p < n; p++) {
    fgMask[p] = bgMask[p] ? 0 : 1
  }

  let processedRegions = 0

  for (let p = 0; p < n; p++) {
    if (!fgMask[p] || visited[p]) continue

    const queue: number[] = [p]
    const component: number[] = []
    visited[p] = 1

    while (queue.length > 0) {
      const cur = queue.shift()!
      component.push(cur)
      const x = cur % w
      const y = Math.floor(cur / w)

      const tryExpand = (nx: number, ny: number) => {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
        const np = ny * w + nx
        if (visited[np] || !fgMask[np]) return
        visited[np] = 1
        queue.push(np)
      }

      tryExpand(x - 1, y)
      tryExpand(x + 1, y)
      tryExpand(x, y - 1)
      tryExpand(x, y + 1)
    }

    if (component.length < minKeepArea) {
      for (const idx of component) {
        bgMask[idx] = 1
      }
    }

    processedRegions++
    if (processedRegions % 100 === 0) {
      await nextFrame()
    }
  }
}

async function protectComplexStructures(
  bgMask: Uint8Array,
  w: number,
  h: number,
  n: number,
  threshold: number,
  minEnclosedArea: number,
  // 新增参数：用于第二次洪水填充的颜色容差检查
  edgeMask: Uint8Array,
  distArr: Float32Array,
  tolThreshold: number,
  complexityWeights: {
    angleChange: number,
    stdDev: number,
    perimeterArea: number,
    circularity: number
  },
  maxEnclosedAreaForComplexity: number,
  perimeterAreaNormalizer: number
): Promise<void> {
  const globalVisited = new Uint8Array(n)
  const enclosedRegions: Array<{
    component: number[],
    edgeSmoothness: number,
    edgeComplexity: number,
    perimeter: number,
    area: number
  }> = []

  let totalEnclosedCount = 0
  let smallRegionCount = 0
  let largeRegionCount = 0
  let restoredPixelCount = 0
  let tooLargeRegionCount = 0  // 新增：记录因面积过大而跳过复杂度分析的区域数

  // 第一遍：找出所有被前景包围的区域并分析边缘特征
  for (let p = 0; p < n; p++) {
    if (!bgMask[p] || globalVisited[p]) continue

    // BFS 找到当前背景连通区域
    const queue: number[] = [p]
    const component: number[] = []
    globalVisited[p] = 1

    while (queue.length > 0) {
      const cur = queue.shift()!
      component.push(cur)
      const x = cur % w
      const y = Math.floor(cur / w)

      const tryExpand = (nx: number, ny: number) => {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
        const np = ny * w + nx
        if (globalVisited[np] || !bgMask[np]) return
        globalVisited[np] = 1
        queue.push(np)
      }

      tryExpand(x - 1, y)
      tryExpand(x + 1, y)
      tryExpand(x, y - 1)
      tryExpand(x, y + 1)
    }

    // 检查这个区域是否被前景包围（不接触图像边界）
    let touchesBorder = false
    for (const idx of component) {
      const x = idx % w
      const y = Math.floor(idx / w)
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        touchesBorder = true
        break
      }
    }

    // 如果接触边界，肯定是真正的背景，跳过
    if (touchesBorder) continue

    totalEnclosedCount++

    // ✅ 修正：如果封闭区域面积 < 最小阈值，说明是误判的透明区域，恢复为前景
    // 面积 >= 最小阈值的封闭区域保持透明（可能是真正的镂空、透明效果）
    if (component.length < minEnclosedArea) {
      smallRegionCount++
      restoredPixelCount += component.length
                        for (const idx of component) {
        bgMask[idx] = 0  // 恢复为前景（不透明）
      }
      continue
    }

    // 新增：针对面积过大的区域，进行特殊处理
    if (component.length > maxEnclosedAreaForComplexity) {
      tooLargeRegionCount++
                        for (const idx of component) {
        bgMask[idx] = 1  // 标记为背景
      }
      continue
    }

    largeRegionCount++

    // 面积 >= minEnclosedArea 的封闭区域继续进行边缘复杂度分析
    // 提取边缘像素（与前景相邻的背景像素）
    const edgePixels: Array<{ x: number, y: number, pos: number }> = []

    for (const idx of component) {
      const x = idx % w
      const y = Math.floor(idx / w)

      // 检查是否是边缘像素（至少有一个前景邻居）
      let isBoundary = false
      const neighbors: Array<[number, number]> = [
        [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
        [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]
      ]

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
        const np = ny * w + nx
        if (!bgMask[np]) { // 邻居是前景
          isBoundary = true
          break
        }
      }

      if (isBoundary) {
        edgePixels.push({ x, y, pos: idx })
      }
    }

    // 如果边缘像素太少，跳过（可能是噪点）
    if (edgePixels.length < 10) {
                        continue
    }

    // 分析边缘平滑度
    const { smoothness, complexity } = analyzeEdgeSmoothness(edgePixels, component.length, complexityWeights, perimeterAreaNormalizer)

        
    enclosedRegions.push({
      component,
      edgeSmoothness: smoothness,
      edgeComplexity: complexity,
      perimeter: edgePixels.length,
      area: component.length
    })
  }

                    
  // 第二遍：根据边缘特征判断处理
  const restoredRegions: number[][] = []  // 记录恢复为前景的区域
  let complexStructureCount = 0
  let smoothStructureCount = 0
  let complexStructurePixels = 0
  let smoothStructurePixels = 0

    
  for (let i = 0; i < enclosedRegions.length; i++) {
    const region = enclosedRegions[i]
    // 综合判断：
    // 1. 边缘复杂度高 (>threshold) → 复杂结构（保留）
    // 2. 边缘平滑度高 (高分数表示平滑) → 意外封闭（移除）

    const isComplexStructure = region.edgeComplexity >= threshold

                        
    if (isComplexStructure) {
      // 复杂结构（高边缘复杂度）：恢复为前景
      complexStructureCount++
      complexStructurePixels += region.area
                        for (const idx of region.component) {
        bgMask[idx] = 0
      }
      restoredRegions.push(region.component)
    } else {
      // 意外封闭结构（边缘平滑）：标记为背景移除
      smoothStructureCount++
      smoothStructurePixels += region.area
                        for (const idx of region.component) {
        bgMask[idx] = 1
      }
    }
  }

            
  // ✅ 修复：第三遍 - 对恢复为前景的区域，重新执行带颜色容差检查的洪水填充
  if (restoredRegions.length > 0) {

    // 收集所有恢复区域边界的背景像素作为新的种子点
    const newSeeds: number[] = []
    const seedSet = new Set<number>()

    for (const component of restoredRegions) {
      for (const idx of component) {
        const x = idx % w
        const y = Math.floor(idx / w)

        // 检查周围8个方向的邻居
        const neighbors: Array<[number, number]> = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
          [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]
        ]

        for (const neighbor of neighbors) {
          const nx = neighbor[0]
          const ny = neighbor[1]
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const np = ny * w + nx

          // 如果邻居是背景且未被访问过，加入种子点
          if (bgMask[np] && !seedSet.has(np)) {
            newSeeds.push(np)
            seedSet.add(np)
          }
        }
      }
    }


    // ✅ 修复：从新种子点开始，执行带颜色容差和边缘检测的保守洪水填充
    const visited = new Uint8Array(n)
    const expandThreshold = tolThreshold * 1.2  // 稍微宽松一点，确保能连接

    for (const seed of newSeeds) {
      if (visited[seed]) continue

      const queue: number[] = [seed]
      visited[seed] = 1

      while (queue.length > 0) {
        const p = queue.shift()!
        const x = p % w
        const y = Math.floor(p / w)

        const tryExpand = (nx: number, ny: number) => {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
          const np = ny * w + nx
          if (visited[np] || !bgMask[np]) return  // 必须是已标记的背景

          // ✅ 新增：检查颜色容差和边缘
          const npDist = distArr[np] ?? Infinity
          const isEdge = edgeMask[np]

          // 使用与第一次洪水填充相同的保守策略
          // 1. 颜色必须在容差范围内
          if (npDist > expandThreshold) return

          // 2. 如果是边缘，必须颜色极度相似
          if (isEdge && npDist > tolThreshold * 0.5) return

          visited[np] = 1
          queue.push(np)
        }

        tryExpand(x - 1, y)
        tryExpand(x + 1, y)
        tryExpand(x, y - 1)
        tryExpand(x, y + 1)
      }
    }

            }

  const totalRestoredPixels = restoredPixelCount + complexStructurePixels
                                }

/**
 * 分析边缘平滑度和复杂度
 * @returns {smoothness: 平滑度(0-100), complexity: 复杂度(0-100)}
 */
function analyzeEdgeSmoothness(
    edgePixels: Array<{ x: number, y: number, pos: number }>,
    area: number,
    complexityWeights: {
        angleChange: number,
        stdDev: number,
        perimeterArea: number,
        circularity: number
    },
    perimeterAreaNormalizer: number
): { smoothness: number, complexity: number } {
    if (edgePixels.length < 3) {
        return { smoothness: 100, complexity: 0 }
    }

    // 1. 计算角度变化率（衡量边缘的曲折程度）
    const angles: number[] = []
    const sampleStep = Math.max(1, Math.floor(edgePixels.length / 50)) // 采样50个点

    for (let i = 0; i < edgePixels.length; i += sampleStep) {
        const prevIndex = (i - sampleStep + edgePixels.length) % edgePixels.length
        const nextIndex = (i + sampleStep) % edgePixels.length

        const prev = edgePixels[prevIndex]
        const curr = edgePixels[i]
        const next = edgePixels[nextIndex]

        // 添加安全检查
        if (!prev || !curr || !next) continue

        // 计算向量角度
        const v1x = curr.x - prev.x
        const v1y = curr.y - prev.y
        const v2x = next.x - curr.x
        const v2y = next.y - curr.y

        const angle1 = Math.atan2(v1y, v1x)
        const angle2 = Math.atan2(v2y, v2x)

        // 角度差（归一化到 -π 到 π）
        let angleDiff = angle2 - angle1
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI

        angles.push(Math.abs(angleDiff))
    }

    // 如果没有有效的角度数据，返回默认值
    if (angles.length === 0) {
        return { smoothness: 100, complexity: 0 }
    }

    // 2. 计算平均角度变化（角度变化越大 = 边缘越曲折）
    const avgAngleChange = angles.reduce((sum, a) => sum + a, 0) / angles.length

    // 3. 计算角度变化的标准差（衡量边缘的不规则性）
    const variance = angles.reduce((sum, a) => sum + Math.pow(a - avgAngleChange, 2), 0) / angles.length
    const stdDev = Math.sqrt(variance)

    // 4. 计算周长面积比（复杂形状的周长相对面积更大）
    const perimeterAreaRatio = edgePixels.length / Math.sqrt(area)

    // 5. 计算圆形度（4πA/P²，圆形为1，越不规则越小）
    const circularity = (4 * Math.PI * area) / (edgePixels.length * edgePixels.length)

    // 计算平滑度分数（0-100，越高越平滑）
    // 平滑的边缘：角度变化小、标准差小、接近圆形
    const smoothness = Math.min(100,
        (1 - avgAngleChange / Math.PI) * 40 +  // 角度变化贡献40%
        (1 - stdDev / Math.PI) * 30 +          // 标准差贡献30%
        circularity * 30                        // 圆形度贡献30%
    ) * 100

    // 计算复杂度分数（0-100，越高越复杂）
    // 复杂的边缘：角度变化大、标准差大、周长面积比大、不规则
    const complexity = Math.min(100,
        (avgAngleChange / Math.PI) * 35 +           // 平均角度变化贡献35%
        (stdDev / Math.PI) * 35 +                   // 标准差贡献35%
        (perimeterAreaRatio / 10) * 20 +            // 周长面积比贡献20%
        (1 - circularity) * 10                      // 非圆形度贡献10%
    ) * 100

    return { smoothness, complexity }
}

/**
 * 精确边缘定位 + 激进腐蚀（增强版）
 * 在指定范围内找到色差最大且距离合理的像素点作为真正的边缘，并针对低色差场景优化
 */
function preciseEdgeErosion(
    bgMask: Uint8Array,
    data: Uint8ClampedArray,
    w: number,
    h: number,
    n: number,
    targetColor: { r: number, g: number, b: number, h: number, s: number, v: number },
    useHsv: boolean,
    tol: number,
    erosionTolerance: number,
    edgePrecision: number,
    aggressiveMode: boolean = false
): Promise<void> {
    // 🆕 激进模式增加到7轮，普通模式5轮
    const rounds = aggressiveMode ? 7 : 5
    const baseThresh = useHsv ? (tol * erosionTolerance) / 255 : tol * erosionTolerance
    const maxAllowedDistance = edgePrecision * 0.7

    return new Promise(async (resolve) => {
        for (let round = 0; round < rounds; round++) {
            const erodeList: number[] = []
            // 🆕 激进模式使用更强的递增系数
            const aggressiveFactor = aggressiveMode ? 0.2 : 0.15
            const currentThresh = baseThresh * (1 + round * aggressiveFactor)

            const chunkSize = 5000
            for (let start = 0; start < n; start += chunkSize) {
                const end = Math.min(start + chunkSize, n)

                for (let p = start; p < end; p++) {
                    if (bgMask[p]) continue

                    const x = p % w
                    const y = Math.floor(p / w)

                    // 第一步：找到最近的背景像素及其距离
                    let minDistToBg = Infinity
                    let closestBgPos = -1

                    for (let dy = -edgePrecision; dy <= edgePrecision; dy++) {
                        for (let dx = -edgePrecision; dx <= edgePrecision; dx++) {
                            if (dx === 0 && dy === 0) continue
                            const nx = x + dx
                            const ny = y + dy
                            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
                            const np = ny * w + nx
                            if (bgMask[np]) {
                                const dist = Math.hypot(dx, dy)
                                if (dist < minDistToBg) {
                                    minDistToBg = dist
                                    closestBgPos = np
                                }
                            }
                        }
                    }

                    if (closestBgPos === -1) continue

                    // 第二步：计算当前点的颜色信息
                    const pi = p * 4
                    const pr = data[pi] ?? 0
                    const pg = data[pi + 1] ?? 0
                    const pb = data[pi + 2] ?? 0

                    // 🆕 第三步增强：计算局部颜色方差，识别毛边
                    let localColorVariance = 0
                    let sampleCount = 0
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            const nx = x + dx
                            const ny = y + dy
                            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
                            const ni = (ny * w + nx) * 4
                            const nr = data[ni] ?? 0
                            const ng = data[ni + 1] ?? 0
                            const nb = data[ni + 2] ?? 0
                            const diff = Math.abs(pr - nr) + Math.abs(pg - ng) + Math.abs(pb - nb)
                            localColorVariance += diff
                            sampleCount++
                        }
                    }
                    localColorVariance /= Math.max(1, sampleCount)

                    // 第四步：在 edgePrecision 范围内，找色差最大的相邻点
                    const colorDiffCandidates: Array<{ pos: number, colorDiff: number, distToBg: number }> = []

                    for (let dy = -edgePrecision; dy <= edgePrecision; dy++) {
                        for (let dx = -edgePrecision; dx <= edgePrecision; dx++) {
                            if (dx === 0 && dy === 0) continue
                            const nx = x + dx
                            const ny = y + dy
                            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
                            const np = ny * w + nx

                            const ni = np * 4
                            const nr = data[ni] ?? 0
                            const ng = data[ni + 1] ?? 0
                            const nb = data[ni + 2] ?? 0

                            const colorDiff = Math.abs(pr - nr) + Math.abs(pg - ng) + Math.abs(pb - nb)
                            const distToCurrentPixel = Math.hypot(dx, dy)

                            if (colorDiff > 10) {
                                colorDiffCandidates.push({ pos: np, colorDiff, distToBg: distToCurrentPixel })
                            }
                        }
                    }

                    colorDiffCandidates.sort((a, b) => b.colorDiff - a.colorDiff)

                    let validEdgeFound = false
                    let maxValidColorDiff = 0

                    for (const candidate of colorDiffCandidates) {
                        const isCandidateBg = bgMask[candidate.pos]

                        if (isCandidateBg) {
                            maxValidColorDiff = candidate.colorDiff
                            validEdgeFound = true
                            break
                        } else if (candidate.distToBg <= maxAllowedDistance) {
                            maxValidColorDiff = Math.max(maxValidColorDiff, candidate.colorDiff)
                            validEdgeFound = true
                        }
                    }

                    const maxColorDiff = colorDiffCandidates.length > 0 ? (colorDiffCandidates[0]?.colorDiff ?? 0) : 0
                    const finalMaxColorDiff = validEdgeFound ? maxValidColorDiff : maxColorDiff
                    const hasSignificantEdge = finalMaxColorDiff > 50
                    const isLowContrastArea = finalMaxColorDiff < 30
                    // 🆕 检测是否为疑似毛边区域（低对比度 + 高局部方差）
                    const isSuspiciousFringe = localColorVariance > 20 && finalMaxColorDiff < 40

                    // 第五步：计算当前点与背景色的距离
                    let dist: number
                    if (useHsv) {
                        const [h, s, v] = rgbToHsv(pr, pg, pb)
                        dist = hsvDistance(h, s, v, targetColor.h, targetColor.s, targetColor.v)
                    } else {
                        const dr = pr - targetColor.r
                        const dg = pg - targetColor.g
                        const db = pb - targetColor.b
                        dist = Math.hypot(dr, dg, db)
                    }

                    // 第六步：综合判断是否需要腐蚀
                    let shouldErode = false

                    // 🆕 针对毛边区域使用更激进的策略
                    if (isSuspiciousFringe || aggressiveMode) {
                        if (dist <= currentThresh * 1.3 && minDistToBg <= 2) {
                            shouldErode = true
                        } else if (dist <= currentThresh * 1.1 && minDistToBg <= 1.5) {
                            shouldErode = true
                        }
                    } else if (isLowContrastArea) {
                        if (dist <= currentThresh * 1.2 && minDistToBg <= 1.5) {
                            shouldErode = true
                        } else if (dist <= currentThresh * 0.9 && minDistToBg <= 2.5) {
                            shouldErode = true
                        }
                    } else if (hasSignificantEdge) {
                        if (dist <= currentThresh * 0.8 && minDistToBg <= 2) {
                            shouldErode = true
                        }
                    } else if (dist <= currentThresh && minDistToBg <= edgePrecision * 0.6) {
                        shouldErode = true
                    }

                    if (shouldErode) {
                        erodeList.push(p)
                    }
                }

                if (end < n) await nextFrame()
            }

            for (const p of erodeList) {
                bgMask[p] = 1
            }

            if (erodeList.length === 0) break
        }

        resolve()
    })
}

/**
 * 🆕 应用边缘羽化和抗锯齿
 * 通过计算边缘像素的半透明度来实现平滑过渡
 */
function applyEdgeFeatheringAndAntiAlias(
  bgMask: Uint8Array,
  alphaMap: Uint8Array,
  data: Uint8ClampedArray,
  distArr: Float32Array,
  w: number,
  h: number,
  n: number,
  targetColor: { r: number, g: number, b: number, h: number, s: number, v: number },
  useHsv: boolean,
  tol: number,
  featherRadius: number,
  enableAntiAlias: boolean
): Promise<void> {
  const tolThreshold = useHsv ? tol / 255 : tol
  const chunkSize = 10000

  return new Promise(async (resolve) => {
    for (let start = 0; start < n; start += chunkSize) {
      const end = Math.min(start + chunkSize, n)

      for (let p = start; p < end; p++) {
        // 跳过已标记为背景的像素
        if (bgMask[p]) {
          alphaMap[p] = 0
          continue
        }

        const x = p % w
        const y = Math.floor(p / w)

        // 检查是否为边缘像素（至少有一个背景邻居）
        let isBoundary = false
        let minDistToBg = Infinity

        const checkRadius = Math.max(1, Math.ceil(featherRadius))
        for (let dy = -checkRadius; dy <= checkRadius; dy++) {
          for (let dx = -checkRadius; dx <= checkRadius; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
            const np = ny * w + nx
            if (bgMask[np]) {
              isBoundary = true
              const dist = Math.hypot(dx, dy)
              minDistToBg = Math.min(minDistToBg, dist)
            }
          }
        }

        if (!isBoundary) {
          alphaMap[p] = 255
          continue
        }

        // 计算当前像素与背景色的相似度
        const dist = distArr[p] ?? 0

        // 归一化距离 (0 = 完全相同, 1 = 完全不同)
        const normalizedDist = Math.min(1, dist / tolThreshold)

        // 基于距离和位置计算透明度
        let alpha = 255

        if (featherRadius > 0) {
          // 边缘羽化：根据到背景的距离计算渐变透明度
          const featherFactor = Math.min(1, minDistToBg / featherRadius)
          const distFactor = normalizedDist

          // 综合两个因素
          const combinedFactor = (featherFactor * 0.6 + distFactor * 0.4)
          alpha = Math.round(255 * combinedFactor)
        } else if (enableAntiAlias) {
          // 仅抗锯齿：基于颜色距离计算
          if (normalizedDist < 0.5) {
            alpha = Math.round(255 * (normalizedDist * 2))
          }
        }

        // 🆕 额外的颜色混合检测：检测是否为背景色渗透
        const pi = p * 4
        const pr = data[pi] ?? 0
        const pg = data[pi + 1] ?? 0
        const pb = data[pi + 2] ?? 0

        // 计算与背景色的相似度
        let colorSimilarity: number
        if (useHsv) {
          const [h, s, v] = rgbToHsv(pr, pg, pb)
          const hsvDist = hsvDistance(h, s, v, targetColor.h, targetColor.s, targetColor.v)
          colorSimilarity = 1 - Math.min(1, hsvDist / 0.5)
        } else {
          const dr = Math.abs(pr - targetColor.r)
          const dg = Math.abs(pg - targetColor.g)
          const db = Math.abs(pb - targetColor.b)
          const rgbDist = (dr + dg + db) / 3
          colorSimilarity = 1 - Math.min(1, rgbDist / 127.5)
        }

        // 如果颜色非常接近背景色，降低透明度
        if (colorSimilarity > 0.7) {
          const penalty = (colorSimilarity - 0.7) / 0.3
          alpha = Math.round(alpha * (1 - penalty * 0.5))
        }

        alphaMap[p] = Math.max(0, Math.min(255, alpha))
      }

      if (end < n) await nextFrame()
    }

    resolve()
  })
}
