// 颜色空间转换工具函数

/**
 * RGB 转 HSV 色彩空间
 */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
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

/**
 * 计算 HSV 色彩空间的距离
 */
export function hsvDistance(h1: number, s1: number, v1: number, h2: number, s2: number, v2: number): number {
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

/**
 * 解析十六进制颜色为 RGB
 */
export function parseHexColor(hex: string): [number, number, number] {
  const s = hex.trim().toLowerCase()
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

