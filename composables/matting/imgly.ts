// ImgLy 背景移除

/**
 * 使用 ImgLy 库进行背景移除
 */
export async function removeBackgroundImgly(
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

