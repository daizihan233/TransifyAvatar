// Chroma Key 抠图算法 - 动漫图优化版 v5
// 优化参数控制：可调节的边缘处理和抗锯齿强度

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

    // 优化的边缘处理参数
    edgeFeather?: number          // 边缘羽化强度 (0-10，0=禁用，默认2)
    antiAliasStrength?: number    // 抗锯齿强度 (0-1，0=禁用，默认0.3)
    edgeRemovalStrength?: number  // 毛边移除强度 (0-2，0=温和，1=标准，2=激进，默认1.0)

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
 * 动漫图 Chroma Key 抠图（v5 - 参数化边缘控制）
 */
export async function removeBackgroundChromaAnime(
    dataUrl: string,
    options: ChromaAnimeOptions,
    onProgress?: (stage: string, percent?: number) => void
): Promise<string> {
    onProgress?.('🔍 读取图片...', 10)
    await nextFrame()

    const hex = options.color || '#00ff00'
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
    const edgeRemovalStrength = options.edgeRemovalStrength ?? 1
    const edgeFeather = options.edgeFeather ?? 2
    const antiAliasStrength = options.antiAliasStrength ?? 0.3

    const complexityWeights = {
        angleChange: options.complexityWeights?.angleChange ?? 35,
        stdDev: options.complexityWeights?.stdDev ?? 35,
        perimeterArea: options.complexityWeights?.perimeterArea ?? 20,
        circularity: options.complexityWeights?.circularity ?? 10
    }
    const maxEnclosedAreaForComplexity = options.maxEnclosedAreaForComplexity ?? 9999
    const perimeterAreaNormalizer = options.perimeterAreaNormalizer ?? 10

    let [tr, tg, tb] = parseHexColor(hex)

    onProgress?.('🖼️ 加载图片数据...', 20)
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

    onProgress?.('🟩 Step 1/6: 标记背景像素...', 40)
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
        console.log('⚠️ [Step 3] 洪水填充已禁用 (强度=-1)')
    }

    // Step 4: 移除小噪点（minKeepArea = 0 时禁用）
    if (minKeepArea > 0) {
        onProgress?.('🧹 清理小噪点...', 70)
        await nextFrame()
        await removeSmallForegroundRegions(bgMask, w, h, n, minKeepArea)
        console.log(`✅ [Step 4] 小区域移除已启用 (最小面积: ${minKeepArea})`)
    } else {
        onProgress?.('⏭️ 跳过小噪点清理', 70)
        console.log('⚠️ [Step 4] 小区域移除已禁用 (最小面积=0)')
    }

    // Step 5: 精确边缘定位 + 激进腐蚀（erosionTolerance = 0 时禁用）
    if (erosionTolerance > 0) {
        onProgress?.(`✂️ Step 5/6: 去除毛边 (强度: ${edgeRemovalStrength})...`, 75)
        await nextFrame()

        // 🔧 统计腐蚀前的透明像素数
        let beforeBgCount = 0
        for (let p = 0; p < n; p++) {
            if (bgMask[p]) beforeBgCount++
        }
        console.log(`[Step 5 前] 透明像素数: ${beforeBgCount}`)

        await preciseEdgeErosion(bgMask, data, w, h, n, { r: tr, g: tg, b: tb, h: th, s: ts, v: tv }, useHsv, tol, erosionTolerance, edgePrecision, edgeRemovalStrength)

        // 🔧 统计腐蚀后的透明像素数
        let afterBgCount = 0
        for (let p = 0; p < n; p++) {
            if (bgMask[p]) afterBgCount++
        }
        console.log(`[Step 5 后] 透明像素数: ${afterBgCount}, 新增透明: ${afterBgCount - beforeBgCount}`)
        console.log(`✅ [Step 5] 边缘腐蚀已启用 (强度: ${erosionTolerance.toFixed(1)}, 精度: ${edgePrecision}, 激进模式: ${edgeRemovalStrength})`)
    } else {
        onProgress?.('⏭️ Step 5/6: 跳过毛边去除', 75)
        console.log('⚠️ [Step 5] 边缘腐蚀已禁用 (强度=0)')
    }

    // 🔧 Step 3.5 移到这里：在边缘腐蚀之后再识别并保护复杂结构
    if (complexStructureThreshold > 0 && minEnclosedArea > 0) {
        onProgress?.('🏗️ Step 5.5/6: 分析并填充封闭区域...', 78)
        await nextFrame()

        // 🔧 统计填充前的透明像素数
        let beforeFillCount = 0
        for (let p = 0; p < n; p++) {
            if (bgMask[p]) beforeFillCount++
        }
        console.log(`[Step 5.5 前] 透明像素数: ${beforeFillCount}`)

        await protectComplexStructures(bgMask, w, h, n, complexStructureThreshold, minEnclosedArea, edgeMask, distArr, useHsv ? tol / 255 : tol, complexityWeights, maxEnclosedAreaForComplexity, perimeterAreaNormalizer)

        // 🔧 统计填充后的透明像素数
        let afterFillCount = 0
        for (let p = 0; p < n; p++) {
            if (bgMask[p]) afterFillCount++
        }
        console.log(`[Step 5.5 后] 透明像素数: ${afterFillCount}, 恢复前景: ${beforeFillCount - afterFillCount}`)
        console.log(`✅ [Step 5.5] 复杂结构保护已启用 (复杂度阈值: ${complexStructureThreshold}, 最小面积: ${minEnclosedArea})`)
    } else {
        onProgress?.('⏭️ Step 5.5/6: 跳过封闭区域分析', 78)
        console.log('⚠️ [Step 5.5] 复杂结构保护已禁用 (阈值=0 或最小面积=0)')
    }

    // 🆕 Step 6: 边缘羽化和抗锯齿
    const alphaMap = new Uint8Array(n)
    alphaMap.fill(255)

    if (edgeFeather > 0 || antiAliasStrength > 0) {
        onProgress?.('✨ Step 6/6: 优化边缘效果...', 85)
        await nextFrame()
        await applyEdgeFeatheringAndAntiAlias(bgMask, alphaMap, data, distArr, w, h, n, { r: tr, g: tg, b: tb, h: th, s: ts, v: tv }, useHsv, tol, edgeFeather, antiAliasStrength)
        console.log(`✅ [Step 6] 边缘优化已启用 (羽化: ${edgeFeather}, 抗锯齿强度: ${antiAliasStrength})`)
    } else {
        onProgress?.('⏭️ Step 6/6: 跳过边缘优化', 85)
        console.log('⚠️ [Step 6] 边缘优化已禁用')
    }

    onProgress?.('🖌️ 合成最终图像...', 90)

    // 🚀 优化：一次性处理所有像素，不再分批
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        if (bgMask[p]) {
            data[i + 3] = 0
        } else {
            data[i + 3] = alphaMap[p]
        }
    }

    onProgress?.('💾 生成PNG图片...', 95)
    await nextFrame()
    ctx.putImageData(id, 0, 0)
    const out = canvas.toDataURL('image/png')

    onProgress?.('✅ 完成！', 100)
    return out
}

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

  // 🚀 优化：不再分批处理，直接一次性处理完
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]

    let dist: number
    if (useHsv) {
      const [h, s, v] = rgbToHsv(r, g, b)
      dist = hsvDistance(h, s, v, targetColor.h, targetColor.s, targetColor.v)
    } else {
      const dr = r - targetColor.r
      const dg = g - targetColor.g
      const db = b - targetColor.b
      dist = Math.sqrt(dr*dr + dg*dg + db*db)
    }

    distArr[p] = dist

    if (dist <= strictThreshold) {
      bgMask[p] = 1
    }
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

  // 🚀 优化：使用更高效的边缘检测，减少重复访问
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x
      const i = p * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]

      // 计算梯度（Sobel算子简化版）
      const i_left = i - 4
      const i_right = i + 4
      const i_top = i - w * 4
      const i_bottom = i + w * 4

      const gradX = Math.abs(data[i_right] - data[i_left]) +
                    Math.abs(data[i_right + 1] - data[i_left + 1]) +
                    Math.abs(data[i_right + 2] - data[i_left + 2])

      const gradY = Math.abs(data[i_bottom] - data[i_top]) +
                    Math.abs(data[i_bottom + 1] - data[i_top + 1]) +
                    Math.abs(data[i_bottom + 2] - data[i_top + 2])

      const gradient = gradX + gradY

      if (gradient > edgeThreshold) {
        edgeMask[p] = 1
      }
    }
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

  // 从图像四边的背景区域开始
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

  // 🚀 优化：减少 nextFrame 调用频率
  let processedCount = 0
  const yieldInterval = 20000  // 每处理2万个像素才让出一次

  while (queue.length > 0) {
    const p = queue.shift()!
    const x = p % w
    const y = Math.floor(p / w)

    const tryExpand = (nx: number, ny: number) => {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
      const np = ny * w + nx
      if (visited[np]) return

      const npDist = distArr[np]
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
    if (processedCount % yieldInterval === 0) {
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
    // 🚀 优化：减少 yield 频率
    if (processedRegions % 500 === 0) {
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
  let tooLargeRegionCount = 0

  // ============ 第一遍：找出所有封闭的透明区域 ============
  console.log(`[复杂结构保护] 开始第一遍扫描，minEnclosedArea=${minEnclosedArea}`)

  for (let p = 0; p < n; p++) {
    // 🔧 修复：检查透明区域（bgMask[p] = 1），而不是前景区域
    if (!bgMask[p] || globalVisited[p]) continue

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
        // 🔧 修复：只扩展到透明区域
        if (globalVisited[np] || !bgMask[np]) return
        globalVisited[np] = 1
        queue.push(np)
      }

      tryExpand(x - 1, y)
      tryExpand(x + 1, y)
      tryExpand(x, y - 1)
      tryExpand(x, y + 1)
    }

    let touchesBorder = false
    for (const idx of component) {
      const x = idx % w
      const y = Math.floor(idx / w)
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        touchesBorder = true
        break
      }
    }

    // 🔧 跳过接触边界的区域（这是真正的背景，不是封闭的透明区域）
    if (touchesBorder) continue

    totalEnclosedCount++

    // 🔧 调试：记录每个区域的处理情况
    if (totalEnclosedCount <= 5) {
      console.log(`[第一遍] 区域 ${totalEnclosedCount}: 面积=${component.length}, minEnclosedArea=${minEnclosedArea}`)
    }

    // 🔧 第一优先级：小于 minEnclosedArea 的封闭透明区域直接恢复为前景
    if (component.length < minEnclosedArea) {
      smallRegionCount++
      restoredPixelCount += component.length
      for (const idx of component) {
        bgMask[idx] = 0  // 恢复为前景（不透明）
      }
      if (totalEnclosedCount <= 5) {
        console.log(`  → 恢复为前景（面积 ${component.length} < ${minEnclosedArea}）`)
      }
      continue
    }

    if (totalEnclosedCount <= 5) {
      console.log(`  → 进入复杂度分析（面积 ${component.length} >= ${minEnclosedArea}）`)
    }

    // 🔧 第二优先级：面积在 [minEnclosedArea, maxEnclosedAreaForComplexity] 之间的区域进行复杂度分析
    if (component.length <= maxEnclosedAreaForComplexity) {
      largeRegionCount++

      // 对中等大小的区域进行边缘复杂度分析
      const edgePixels: Array<{ x: number, y: number, pos: number }> = []

      for (const idx of component) {
        const x = idx % w
        const y = Math.floor(idx / w)

        let isBoundary = false
        const neighbors: Array<[number, number]> = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
          [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]
        ]

        for (const [nx, ny] of neighbors) {
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const np = ny * w + nx
          if (!bgMask[np]) {
            isBoundary = true
            break
          }
        }

        if (isBoundary) {
          edgePixels.push({ x, y, pos: idx })
        }
      }

      if (edgePixels.length >= 10) {
        const { smoothness, complexity } = analyzeEdgeSmoothness(edgePixels, component.length, complexityWeights, perimeterAreaNormalizer)

        enclosedRegions.push({
          component,
          edgeSmoothness: smoothness,
          edgeComplexity: complexity,
          perimeter: edgePixels.length,
          area: component.length
        })
      }
    } else {
      // 🔧 第三优先级：面积过大的区域保持透明（可能是真正的大面积透明效果，如窗户、眼睛等）
      tooLargeRegionCount++
      // 保持透明，不做任何操作
    }
  }

  // ============ 第二遍：基于边缘复杂度决定是否恢复 ============
  const restoredRegions: number[][] = []
  let complexStructureCount = 0
  let smoothStructureCount = 0
  let complexStructurePixels = 0
  let smoothStructurePixels = 0

  for (let i = 0; i < enclosedRegions.length; i++) {
    const region = enclosedRegions[i]
    const isComplexStructure = region.edgeComplexity >= threshold

    if (isComplexStructure) {
      // 边缘复杂 → 恢复为前景（可能是被误判的复杂结构）
      complexStructureCount++
      complexStructurePixels += region.area
      for (const idx of region.component) {
        bgMask[idx] = 0
      }
      restoredRegions.push(region.component)
    } else {
      // 边缘平滑 → 保持透明（可能是真正的镂空）
      smoothStructureCount++
      smoothStructurePixels += region.area
      // 保持透明
    }
  }

  // ============ 第三遍：对恢复的复杂结构周围进行洪水填充 ============
  if (restoredRegions.length > 0) {
    const newSeeds: number[] = []
    const seedSet = new Set<number>()

    for (const component of restoredRegions) {
      for (const idx of component) {
        const x = idx % w
        const y = Math.floor(idx / w)

        const neighbors: Array<[number, number]> = [
          [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
          [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]
        ]

        for (const neighbor of neighbors) {
          const nx = neighbor[0]
          const ny = neighbor[1]
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
          const np = ny * w + nx

          if (bgMask[np] && !seedSet.has(np)) {
            newSeeds.push(np)
            seedSet.add(np)
          }
        }
      }
    }

    const visited = new Uint8Array(n)
    const expandThreshold = tolThreshold * 1.2

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
          if (visited[np] || !bgMask[np]) return

          const npDist = distArr[np]
          const isEdge = edgeMask[np]

          if (npDist > expandThreshold) return
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

  // ============ 🔧 第四遍（关键修复）：再次检查所有剩余的封闭透明区域 ============
  // 将小于 minEnclosedArea 的透明区域全部恢复为前景
  const finalVisited = new Uint8Array(n)
  let finalSmallRegionCount = 0
  let finalRestoredPixels = 0
  let finalSkippedBorderRegions = 0  // 🔧 新增：记录因接触边界而跳过的区域数

  for (let p = 0; p < n; p++) {
    if (!bgMask[p] || finalVisited[p]) continue

    const queue: number[] = [p]
    const component: number[] = []
    finalVisited[p] = 1

    while (queue.length > 0) {
      const cur = queue.shift()!
      component.push(cur)
      const x = cur % w
      const y = Math.floor(cur / w)

      const tryExpand = (nx: number, ny: number) => {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) return
        const np = ny * w + nx
        if (finalVisited[np] || !bgMask[np]) return
        finalVisited[np] = 1
        queue.push(np)
      }

      tryExpand(x - 1, y)
      tryExpand(x + 1, y)
      tryExpand(x, y - 1)
      tryExpand(x, y + 1)
    }

    // 检查是否接触边界
    let touchesBorder = false
    for (const idx of component) {
      const x = idx % w
      const y = Math.floor(idx / w)
      if (x === 0 || x === w - 1 || y === 0 || y === h - 1) {
        touchesBorder = true
        break
      }
    }

    // 🔧 关键修复：即使接触边界，如果面积很小也应该恢复
    // 因为这些可能是通过洪水填充意外连接到边界的小区域
    if (!touchesBorder && component.length < minEnclosedArea) {
      finalSmallRegionCount++
      finalRestoredPixels += component.length
      for (const idx of component) {
        bgMask[idx] = 0  // 恢复为前景
      }
    } else if (touchesBorder && component.length < minEnclosedArea) {
      // 🔧 新增：对接触边界但面积很小的区域，也进行恢复
      // 设置一个更严格的阈值（例如 minEnclosedArea 的 1/3）
      const strictThreshold = Math.floor(minEnclosedArea / 3)
      if (component.length < strictThreshold) {
        finalSmallRegionCount++
        finalRestoredPixels += component.length
        for (const idx of component) {
          bgMask[idx] = 0  // 恢复为前景
        }
        console.log(`[第四遍] 恢复接触边界的小区域: 面积=${component.length}像素 (阈值=${strictThreshold})`)
      } else {
        finalSkippedBorderRegions++
      }
    }
  }

  const totalRestoredPixels = restoredPixelCount + complexStructurePixels + finalRestoredPixels

  console.log(`[复杂结构保护] 总封闭区域: ${totalEnclosedCount}, 初次恢复: ${smallRegionCount}个(${restoredPixelCount}像素)`)
  console.log(`[复杂结构保护] 分析: ${largeRegionCount}个, 太大跳过: ${tooLargeRegionCount}个`)
  console.log(`[复杂结构保护] 复杂结构恢复: ${complexStructureCount}个(${complexStructurePixels}像素), 平滑保持透明: ${smoothStructureCount}个(${smoothStructurePixels}像素)`)
  console.log(`[复杂结构保护] 🔧 最终清理小透明区域: ${finalSmallRegionCount}个(${finalRestoredPixels}像素), 跳过边界区域: ${finalSkippedBorderRegions}个`)
  console.log(`[复杂结构保护] 📊 总计恢复: ${totalRestoredPixels}像素`)
}

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

    const angles: number[] = []
    const sampleStep = Math.max(1, Math.floor(edgePixels.length / 50))

    for (let i = 0; i < edgePixels.length; i += sampleStep) {
        const prevIndex = (i - sampleStep + edgePixels.length) % edgePixels.length
        const nextIndex = (i + sampleStep) % edgePixels.length

        const prev = edgePixels[prevIndex]
        const curr = edgePixels[i]
        const next = edgePixels[nextIndex]

        if (!prev || !curr || !next) continue

        const v1x = curr.x - prev.x
        const v1y = curr.y - prev.y
        const v2x = next.x - curr.x
        const v2y = next.y - curr.y

        const angle1 = Math.atan2(v1y, v1x)
        const angle2 = Math.atan2(v2y, v2x)

        let angleDiff = angle2 - angle1
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI

        angles.push(Math.abs(angleDiff))
    }

    if (angles.length === 0) {
        return { smoothness: 100, complexity: 0 }
    }

    const avgAngleChange = angles.reduce((sum, a) => sum + a, 0) / angles.length
    const variance = angles.reduce((sum, a) => sum + Math.pow(a - avgAngleChange, 2), 0) / angles.length
    const stdDev = Math.sqrt(variance)
    const perimeterAreaRatio = edgePixels.length / Math.sqrt(area)
    const circularity = (4 * Math.PI * area) / (edgePixels.length * edgePixels.length)

    const smoothness = Math.min(100,
        (1 - avgAngleChange / Math.PI) * 40 +
        (1 - stdDev / Math.PI) * 30 +
        circularity * 30
    ) * 100

    const complexity = Math.min(100,
        (avgAngleChange / Math.PI) * 35 +
        (stdDev / Math.PI) * 35 +
        (perimeterAreaRatio / 10) * 20 +
        (1 - circularity) * 10
    ) * 100

    return { smoothness, complexity }
}

async function preciseEdgeErosion(
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
    edgeRemovalStrength: number = 1.0
): Promise<void> {
    console.log(`[边缘腐蚀] 开始处理，强度: ${edgeRemovalStrength}`)

    // 🚀 关键优化：预计算距离图，避免重复计算
    const distanceMap = new Float32Array(n)
    for (let p = 0; p < n; p++) {
        if (bgMask[p]) {
            distanceMap[p] = -1  // 背景标记为-1
        } else {
            distanceMap[p] = Infinity
        }
    }

    // 使用距离变换计算每个前景像素到最近背景的距离
    // 第一遍：从左上到右下
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = y * w + x
            if (bgMask[p]) continue

            let minDist = distanceMap[p]

            if (x > 0) {
                const left = p - 1
                if (bgMask[left]) minDist = Math.min(minDist, 1)
                else minDist = Math.min(minDist, distanceMap[left] + 1)
            }

            if (y > 0) {
                const top = p - w
                if (bgMask[top]) minDist = Math.min(minDist, 1)
                else minDist = Math.min(minDist, distanceMap[top] + 1)
            }

            distanceMap[p] = minDist
        }
    }

    // 第二遍：从右下到左上
    for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
            const p = y * w + x
            if (bgMask[p]) continue

            let minDist = distanceMap[p]

            if (x < w - 1) {
                const right = p + 1
                if (bgMask[right]) minDist = Math.min(minDist, 1)
                else minDist = Math.min(minDist, distanceMap[right] + 1)
            }

            if (y < h - 1) {
                const bottom = p + w
                if (bgMask[bottom]) minDist = Math.min(minDist, 1)
                else minDist = Math.min(minDist, distanceMap[bottom] + 1)
            }

            distanceMap[p] = minDist
        }
    }

    // 🔧 增强激进模式的效果
    const rounds = Math.max(5, Math.min(15, Math.floor(edgeRemovalStrength * 10)))  // 根据强度调整轮数
    const baseThresh = useHsv ? (tol * erosionTolerance) / 255 : tol * erosionTolerance

    let totalErodedPixels = 0

    for (let round = 0; round < rounds; round++) {
        const erodeList: number[] = []
        // 🔧 激进模式使用更强的递增系数
        const aggressiveFactor = 0.15 + 0.05 * round  // 随轮次增加而增强
        const currentThresh = baseThresh * (1 + round * aggressiveFactor)

        // 🚀 优化：只检查距离<=edgePrecision的像素
        for (let p = 0; p < n; p++) {
            if (bgMask[p]) continue
            if (distanceMap[p] > edgePrecision) continue

            const i = p * 4
            const pr = data[i]
            const pg = data[i + 1]
            const pb = data[i + 2]

            let dist: number
            if (useHsv) {
                const [h, s, v] = rgbToHsv(pr, pg, pb)
                dist = hsvDistance(h, s, v, targetColor.h, targetColor.s, targetColor.v)
            } else {
                const dr = pr - targetColor.r
                const dg = pg - targetColor.g
                const db = pb - targetColor.b
                dist = Math.sqrt(dr*dr + dg*dg + db*db)
            }

            // 🔧 增强激进模式的判断逻辑
            let shouldErode = false

            shouldErode = dist <= currentThresh

            if (shouldErode) {
                erodeList.push(p)
            }
        }

        // 应用腐蚀
        for (const p of erodeList) {
            bgMask[p] = 1
            distanceMap[p] = -1
        }

        totalErodedPixels += erodeList.length

        // 🚀 优化：只在必要时让出线程
        if (round % 2 === 0 && round > 0) {
            await nextFrame()
        }

        // 🔧 添加调试日志（只记录前3轮和最后一轮）
        if (round < 3 || round === rounds - 1) {
            console.log(`[边缘腐蚀] 第${round + 1}轮: 腐蚀${erodeList.length}个像素, 阈值=${currentThresh.toFixed(3)}`)
        }
    }

    console.log(`[边缘腐蚀] 完成，总计腐蚀 ${totalErodedPixels} 个像素`)
}

async function applyEdgeFeatheringAndAntiAlias(
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
    edgeFeather: number,
    antiAliasStrength: number
): Promise<void> {
    const featherRadius = Math.max(1, Math.floor(edgeFeather))
    const tolThreshold = useHsv ? tol / 255 : tol

    // 🚀 优化：先找出所有边缘像素，避免重复搜索
    const edgePixels: number[] = []
    for (let p = 0; p < n; p++) {
        if (bgMask[p]) continue

        const x = p % w
        const y = Math.floor(p / w)

        // 快速检查是否为边缘
        let isEdge = false
        if (x > 0 && bgMask[p - 1]) isEdge = true
        else if (x < w - 1 && bgMask[p + 1]) isEdge = true
        else if (y > 0 && bgMask[p - w]) isEdge = true
        else if (y < h - 1 && bgMask[p + w]) isEdge = true

        if (isEdge) {
            edgePixels.push(p)
        }
    }

    // 只对边缘像素及其邻域应用羽化
    for (const p of edgePixels) {
        const x = p % w
        const y = Math.floor(p / w)

        for (let dy = -featherRadius; dy <= featherRadius; dy++) {
            for (let dx = -featherRadius; dx <= featherRadius; dx++) {
                const nx = x + dx
                const ny = y + dy
                if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue

                const np = ny * w + nx
                if (bgMask[np]) continue

                const distance = Math.sqrt(dx * dx + dy * dy)
                if (distance > featherRadius) continue

                const colorDist = distArr[np]
                const normalizedDist = useHsv ? colorDist : colorDist / 255

                let alpha = 255
                if (normalizedDist < tolThreshold * 1.5) {
                    const fadeStart = tolThreshold * 0.8
                    const fadeEnd = tolThreshold * 1.5
                    const fadeRange = fadeEnd - fadeStart
                    const fadeAmount = Math.max(0, Math.min(1, (normalizedDist - fadeStart) / fadeRange))
                    alpha = Math.round(255 * fadeAmount)
                }

                if (antiAliasStrength > 0 && distance > 0) {
                    const edgeFade = 1 - (distance / (featherRadius + 1))
                    alpha = Math.round(alpha * (0.7 + edgeFade * 0.3))
                }

                alphaMap[np] = Math.min(alphaMap[np], alpha)
            }
        }
    }
}
