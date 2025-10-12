<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadedImage } from '~~/composables/useUploadedImage'
import { useMatting } from '~~/composables/useMatting'

const router = useRouter()
const { croppedImage, mattedImage } = useUploadedImage()
const { removeBg, loading, error } = useMatting()

// UI state
const percent = ref(0)
const stage = ref('')
const running = ref(false)
const localResult = ref<string | null>(null)

function stageLabel(s: string) {
  switch (s) {
    case 'loading model': return '正在加载模型...'
    case 'model ready': return '模型准备就绪'
    case 'reading image': return '读取图片...'
    case 'preprocess': return '预处理图片...'
    case 'infer': return 'AI 正在分析前景...'
    case 'resize mask': return '生成掩码...'
    case 'composite': return '融合透明背景...'
    case 'done': return '完成'
    default: return s
  }
}

async function startProcess() {
  if (!croppedImage.value) {
    router.replace('/cut')
    return
  }
  running.value = true
  percent.value = 0
  stage.value = stageLabel('loading model')
  try {
    const out = await removeBg(croppedImage.value, (s, p) => {
      stage.value = stageLabel(s)
      if (typeof p === 'number') percent.value = Math.max(0, Math.min(100, Math.round(p)))
    })
    localResult.value = out
    mattedImage.value = out
    percent.value = 100
    stage.value = stageLabel('done')
  } catch (e) {
    // error ref already set
  } finally {
    running.value = false
  }
}

function downloadResult() {
  if (!localResult.value) return
  const a = document.createElement('a')
  a.href = localResult.value
  a.download = 'cutout.png'
  a.click()
}

function backToCut() { router.push('/cut') }
function backHome() { router.push('/') }

onMounted(() => { startProcess() })
</script>

<template>
  <div class="process-page">
    <n-card title="AI 去背景处理中" size="large" class="panel">
      <div v-if="!croppedImage" class="center">
        <n-result status="404" title="没有可处理的图片" description="请先完成裁剪">
          <template #footer>
            <n-button @click="backToCut">返回裁剪</n-button>
          </template>
        </n-result>
      </div>

      <template v-else>
        <div v-if="running || loading" class="progress">
          <n-progress type="line" :percentage="percent" indicator-placement="inside" processing :height="18" />
          <n-text depth="3" style="margin-top: 8px; display:block;">{{ stage }}</n-text>
        </div>

        <div v-if="error" class="mt">
          <n-alert type="error" :title="'处理失败'">{{ error }}</n-alert>
          <div class="actions">
            <n-button type="primary" @click="startProcess">重试</n-button>
            <n-button @click="backToCut">返回裁剪</n-button>
          </div>
        </div>

        <div v-if="localResult && !running && !loading" class="result mt">
          <div class="preview">
            <img :src="localResult" alt="cutout" />
          </div>
          <div class="actions">
            <n-button type="success" @click="downloadResult">下载抠图PNG</n-button>
            <n-button @click="backToCut">返回裁剪</n-button>
            <n-button @click="backHome">完成</n-button>
          </div>
        </div>
      </template>
    </n-card>
  </div>
</template>

<style scoped>
.process-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.panel { width: min(900px, 96vw); }
.progress { padding: 12px 4px; }
.mt { margin-top: 16px; }
.actions { display: flex; gap: 12px; margin-top: 12px; }
.preview {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px;
  background: conic-gradient(#eee 25%, transparent 0) 0 0/20px 20px content-box, #fafafa;
  border: 1px solid #eee;
  border-radius: 8px;
}
.preview img { max-width: 100%; height: auto; display: block; }
.center { display: flex; align-items: center; justify-content: center; }
</style>