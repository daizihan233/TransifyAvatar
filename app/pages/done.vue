<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadedImage } from '~~/composables/useUploadedImage'

const router = useRouter()
const { croppedImage } = useUploadedImage()

const previewUrl = ref<string | null>(null)
const imgEl = ref<HTMLImageElement | null>(null)
const w = ref(0)
const h = ref(0)

const COLORS = ['#5BCFFA', '#F5ABB9', '#FFFFFF', '#F5ABB9', '#5BCFFA'] as const

function compose() {
  if (!imgEl.value) return
  const width = Math.max(1, imgEl.value.naturalWidth || imgEl.value.width)
  const height = Math.max(1, imgEl.value.naturalHeight || imgEl.value.height)
  w.value = width; h.value = height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  // draw 5 equal-height horizontal stripes
  for (let i = 0; i < 5; i++) {
    const y0 = Math.round((i * height) / 5)
    const y1 = Math.round(((i + 1) * height) / 5)
    const color = COLORS[i] ?? '#000'
    ctx.fillStyle = color
    ctx.fillRect(0, y0, width, Math.max(1, y1 - y0))
  }
  // draw transparent PNG on top
  ctx.drawImage(imgEl.value, 0, 0, width, height)
  previewUrl.value = canvas.toDataURL('image/png')
}

function onImageLoad() { compose() }

function downloadResult() {
  if (!previewUrl.value) return
  const a = document.createElement('a')
  a.href = previewUrl.value
  a.download = 'trans-flag-bg.png'
  a.click()
}

watch(() => croppedImage.value, () => { previewUrl.value = null })
</script>

<template>
  <div class="done-page">
    <n-card title="完成 · 添加横条背景" size="large" class="panel">
      <div v-if="!croppedImage" class="center">
        <n-result status="404" title="没有裁剪结果" description="请先完成裁剪">
          <template #footer>
            <n-button @click="router.push('/cut')">返回裁剪</n-button>
          </template>
        </n-result>
      </div>

      <template v-else>
        <div class="layout">
          <div class="preview-col">
            <n-card size="small" title="预览" :bordered="true">
              <div class="preview-box">
                <img v-if="croppedImage" :src="croppedImage!" alt="cutout" ref="imgEl" @load="onImageLoad" style="display:none;" />
                <img v-if="previewUrl" :src="previewUrl" alt="preview" class="visible" />
              </div>
              <template #footer>
                <n-space>
                  <n-button type="success" :disabled="!previewUrl" @click="downloadResult">下载图片</n-button>
                  <n-button @click="router.push('/cut')">返回裁剪</n-button>
                  <n-button @click="router.push('/')">返回上传</n-button>
                </n-space>
              </template>
            </n-card>
          </div>
          <div class="info-col">
            <n-card size="small" :bordered="true" title="背景说明">
              <n-space vertical>
                <div>为透明底图片添加 5 条等高横条背景：</div>
                <div class="swatches">
                  <span v-for="(c, i) in COLORS" :key="i" class="sw" :style="{ background: c }"></span>
                </div>
                <n-text depth="3">顺序：#5BCFFA → #F5ABB9 → #FFFFFF → #F5ABB9 → #5BCFFA</n-text>
                <n-text depth="3">输出尺寸：{{ w }} × {{ h }}</n-text>
              </n-space>
            </n-card>
          </div>
        </div>
      </template>
    </n-card>
  </div>
</template>

<style scoped>
.done-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.panel { width: min(1000px, 98vw); }
.layout { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
.preview-box { width: 100%; min-height: 360px; display: flex; align-items: center; justify-content: center; border: 1px solid #eee; border-radius: 8px; padding: 8px; background: #fff; }
.preview-box img.visible { max-width: 100%; height: auto; display: block; }
.center { display: flex; align-items: center; justify-content: center; }
.swatches { display: grid; grid-template-columns: repeat(5, 1fr); height: 12px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; }
.sw { display: block; height: 12px; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>