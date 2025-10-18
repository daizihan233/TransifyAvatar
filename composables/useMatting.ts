// AI 抠像（去背景）基于 Transformers.js RMBG-1.4 模型（image-segmentation pipeline）
// 仅在浏览器端加载与运行

import { ref, onMounted } from 'vue'
import { removeBackgroundChroma, type ChromaOptions } from './matting/chromaKey'
import { removeBackgroundChromaAnime, type ChromaAnimeOptions } from './matting/chromaKeyAnime'
import { removeBackgroundImgly } from './matting/imgly'
import { removeBackgroundTransformers, ensureLoaded } from './matting/transformers'

export type MattingBackend = 'transformers' | 'imgly' | 'chroma' | 'chroma-anime'

export type { ChromaOptions, ChromaAnimeOptions }

export function useMatting() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 🔧 关键修复：只在客户端环境中预加载模型
  onMounted(async () => {
    // 确保在客户端环境
    if (typeof window === 'undefined') {
      console.warn('[useMatting] 跳过服务端模型加载')
      return
    }

    try {
      console.log('[useMatting] 客户端预加载模型...')
      await ensureLoaded()
      console.log('[useMatting] 模型预加载完成')
    } catch (e) {
      console.error('[useMatting] 模型预加载失败:', e)
      // 不抛出错误，让用户在实际使用时再处理
    }
  })

  const removeBg = async (
    dataUrl: string,
    onProgress?: (stage: string, percent?: number) => void,
    options?: {
      backend?: MattingBackend
      chroma?: ChromaOptions
      chromaAnime?: ChromaAnimeOptions
    }
  ): Promise<string> => {
    if (!dataUrl) throw new Error('No image provided')

    // 🔧 客户端检查
    if (typeof window === 'undefined') {
      throw new Error('背景移除功能只能在浏览器中使用')
    }

    loading.value = true
    error.value = null

    try {
      const backend: MattingBackend = options?.backend ?? 'transformers'

      if (backend === 'chroma') {
        if (!options?.chroma) {
          throw new Error('Chroma options are required for chroma backend')
        }
        return await removeBackgroundChroma(dataUrl, options.chroma, onProgress)
      }

      if (backend === 'chroma-anime') {
        if (!options?.chromaAnime) {
          throw new Error('ChromaAnime options are required for chroma-anime backend')
        }
        return await removeBackgroundChromaAnime(dataUrl, options.chromaAnime, onProgress)
      }

      if (backend === 'imgly') {
        return await removeBackgroundImgly(dataUrl, onProgress)
      }

      return await removeBackgroundTransformers(dataUrl, onProgress)
    } catch (e: any) {
      const errMsg = e?.message || String(e)
      error.value = errMsg
      console.error('[useMatting] 背景移除失败:', errMsg)
      throw e
    } finally {
      loading.value = false
    }
  }

  return { removeBg, loading, error }
}