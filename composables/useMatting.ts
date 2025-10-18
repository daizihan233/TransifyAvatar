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
      chromaAnime?: ChromaAnimeOptions
    }
  ): Promise<string> => {
    if (!dataUrl) throw new Error('No image provided')
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
      error.value = e?.message || String(e)
      throw e
    } finally {
      loading.value = false
    }
  }

  return { removeBg, loading, error }
}