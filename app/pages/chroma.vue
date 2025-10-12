<script setup lang="ts">
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadedImage } from '~~/composables/useUploadedImage'
import { useMatting } from '~~/composables/useMatting'

const router = useRouter()
const { uploadedImage, mattedImage } = useUploadedImage()
const { removeBg, loading, error } = useMatting()

// Params
const chroma = reactive({
  color: '#00ff00',
  tolerance: 40,
  softness: 20,
  minRemoveArea: 64,
  minKeepArea: 36,
  edgeRadius: 2,
  edgeExtraTolerance: 15
})

const previewUrl = ref<string | null>(null)
const running = ref(false)
const darkBg = ref(true)
let timer: any = null
let seq = 0

function debounceRun(ms = 200) {
  if (!uploadedImage.value) return
  if (timer) { clearTimeout(timer); timer = null }
  timer = setTimeout(async () => {
    const id = ++seq
    running.value = true
    try {
      const out = await removeBg(
        uploadedImage.value!,
        undefined,
        { backend: 'chroma', chroma: {
          color: chroma.color,
          tolerance: chroma.tolerance,
          softness: chroma.softness,
          minRemoveArea: chroma.minRemoveArea,
          minKeepArea: chroma.minKeepArea,
          edgeRadius: chroma.edgeRadius,
          edgeExtraTolerance: chroma.edgeExtraTolerance
        }}
      )
      if (id === seq) previewUrl.value = out
    } catch {
      // error state handled by composable
    } finally {
      if (id === seq) running.value = false
    }
  }, ms)
}

watch(() => uploadedImage.value, (v) => { if (v) debounceRun(0) })
watch(chroma, () => debounceRun(200), { deep: true })

onMounted(() => { if (uploadedImage.value) debounceRun(0) })
onBeforeUnmount(() => { if (timer) clearTimeout(timer) })

function applyAndBack() {
  if (previewUrl.value) {
    mattedImage.value = previewUrl.value
    router.push('/process')
  }
}
function applyAndCut() {
  if (previewUrl.value) {
    mattedImage.value = previewUrl.value
    router.push('/cut')
  }
}
function backHome() { router.push('/') }
function downloadPreview() {
  if (!previewUrl.value) return
  const a = document.createElement('a')
  a.href = previewUrl.value
  a.download = 'chroma-cutout.png'
  a.click()
}
</script>

<template>
  <div class="chroma-page">
    <n-card title="纯色抠图 · 实时预览" size="large" class="panel">
      <div v-if="!uploadedImage" class="center">
        <n-result status="404" title="没有可处理的图片" description="请先上传图片">
          <template #footer>
            <n-button @click="backHome">返回上传</n-button>
          </template>
        </n-result>
      </div>

      <template v-else>
        <div class="layout">
          <div class="controls">
            <n-card size="small" :bordered="true">
              <n-space vertical style="width: 100%;">
                <n-space vertical align="center" style="width: 100%;">
                  <n-text depth="3">背景颜色：</n-text>
                  <n-color-picker v-model:value="chroma.color" :show-alpha="false" :actions="['confirm']" size="small" style="width: 240px;" />
                </n-space>
                <n-space vertical>
                  <n-text depth="3">容差：{{ chroma.tolerance }}</n-text>
                  <n-slider v-model:value="chroma.tolerance" :min="0" :max="255" :step="1" />
                </n-space>
                <n-space vertical>
                  <n-text depth="3">软过渡：{{ chroma.softness }}</n-text>
                  <n-slider v-model:value="chroma.softness" :min="0" :max="255" :step="1" />
                </n-space>
                <n-space vertical>
                  <n-text depth="3">小块去除的最小面积（像素）：{{ chroma.minRemoveArea }}</n-text>
                  <n-slider v-model:value="chroma.minRemoveArea" :min="0" :max="512" :step="1" />
                </n-space>
                <n-space vertical>
                  <n-text depth="3">小块保留的最小面积（像素）：{{ chroma.minKeepArea }}</n-text>
                  <n-slider v-model:value="chroma.minKeepArea" :min="0" :max="512" :step="1" />
                </n-space>
                <n-space vertical>
                  <n-text depth="3">仅边缘扩大容差半径（像素）：{{ chroma.edgeRadius }}</n-text>
                  <n-slider v-model:value="chroma.edgeRadius" :min="0" :max="20" :step="1" />
                </n-space>
                <n-space vertical>
                  <n-text depth="3">边缘额外容差：{{ chroma.edgeExtraTolerance }}</n-text>
                  <n-slider v-model:value="chroma.edgeExtraTolerance" :min="0" :max="100" :step="1" />
                </n-space>
                <n-space align="center">
                  <n-text depth="3">黑底预览：</n-text>
                  <n-switch v-model:value="darkBg" />
                </n-space>
                <n-alert v-if="error" type="warning">{{ error }}</n-alert>
                <n-space>
                  <n-button type="primary" :disabled="!previewUrl" @click="applyAndBack">应用并返回处理</n-button>
                  <n-button type="info" :disabled="!previewUrl" @click="applyAndCut">应用并去裁剪</n-button>
                  <n-button :disabled="!previewUrl" @click="downloadPreview">下载预览PNG</n-button>
                </n-space>
              </n-space>
            </n-card>
          </div>
          <div class="preview">
            <n-card size="small" title="预览" :bordered="true">
              <div class="preview-box" :style="darkBg ? { background: '#000' } : {}">
                <img v-if="previewUrl" :src="previewUrl" alt="preview" />
                <img v-else :src="uploadedImage!" alt="source" />
                <div v-if="running || loading" class="overlay">
                  <n-spin size="large">渲染中...</n-spin>
                </div>
              </div>
            </n-card>
            <n-card size="small" title="原图" :bordered="true" style="margin-top: 12px;">
              <div class="preview-box" :style="darkBg ? { background: '#000' } : {}">
                <img :src="uploadedImage!" alt="source" />
              </div>
            </n-card>
          </div>
        </div>
      </template>
    </n-card>
  </div>
</template>

<style scoped>
.chroma-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.panel { width: min(1100px, 98vw); }
.layout { display: grid; grid-template-columns: 380px 1fr; gap: 16px; }
.preview-box { position: relative; width: 100%; background:
  conic-gradient(#eee 25%, transparent 0) 0 0/20px 20px content-box, #fafafa;
  border: 1px solid #eee; border-radius: 8px; padding: 8px; display:flex; align-items:center; justify-content:center; min-height: 360px; }
.preview-box img { max-width: 100%; height: auto; display: block; }
.overlay { position: absolute; inset: 0; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.5); }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
