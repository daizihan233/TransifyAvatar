<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadedImage } from '~~/composables/useUploadedImage'
import { useMatting, type MattingBackend } from '~~/composables/useMatting'

const router = useRouter()
const { croppedImage, mattedImage } = useUploadedImage()
const { removeBg, loading, error } = useMatting()

// Backend selection first
const backend = ref<MattingBackend>('transformers')
const selected = ref(false)

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
  selected.value = true
  running.value = true
  percent.value = 0
  stage.value = stageLabel('loading model')
  localResult.value = null
  try {
    const out = await removeBg(croppedImage.value, (s, p) => {
      stage.value = stageLabel(s)
      if (typeof p === 'number') percent.value = Math.max(0, Math.min(100, Math.round(p)))
    }, { backend: backend.value })
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

function reselectBackend() {
  if (running.value) return
  selected.value = false
  localResult.value = null
  stage.value = ''
  percent.value = 0
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
</script>

<template>
  <div class="process-page">
    <n-card title="AI 去背景" size="large" class="panel">
      <div v-if="!croppedImage" class="center">
        <n-result status="404" title="没有可处理的图片" description="请先完成裁剪">
          <template #footer>
            <n-button @click="backToCut">返回裁剪</n-button>
          </template>
        </n-result>
      </div>

      <template v-else>
        <div class="mt">
          <n-space align="center" justify="space-between">
            <div>
              <n-text depth="3">算法后端</n-text>
              <template v-if="!selected">
                <n-radio-group v-model:value="backend" size="small" style="margin-left: 8px;">
                  <n-radio value="transformers">精细（RMBG-1.4）</n-radio>
                  <n-radio value="imgly">快速（IMG.LY）</n-radio>
                </n-radio-group>
              </template>
              <template v-else>
                <n-tag type="primary" size="small" style="margin-left: 8px;">
                  已选择：{{ backend === 'transformers' ? 'RMBG（Transformers）' : 'IMG.LY' }}
                </n-tag>
              </template>
            </div>
            <div>
              <n-button v-if="!selected" type="primary" :loading="running || loading" @click="startProcess">开始处理</n-button>
              <n-space v-else align="center">
                <n-button tertiary size="small" :disabled="running || loading" @click="reselectBackend">重选模型</n-button>
                <n-button tertiary size="small" :loading="running || loading" @click="startProcess">重试当前后端</n-button>
              </n-space>
            </div>
          </n-space>
        </div>

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