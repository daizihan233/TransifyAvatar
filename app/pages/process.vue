<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadedImage } from '~~/composables/useUploadedImage'
import { useMatting, type MattingBackend } from '~~/composables/useMatting'

const router = useRouter()
const { uploadedImage, mattedImage } = useUploadedImage()
const { removeBg, loading, error } = useMatting()

// Backend selection first
const backend = ref<MattingBackend>('transformers')
const selected = ref(false)
// Chroma key options
const chroma = reactive({
  color: '#00ff00',
  tolerance: 40,
  softness: 20,
  minRemoveArea: 64,
  minKeepArea: 36,
  edgeRadius: 2,
  edgeExtraTolerance: 15
})

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
  if (!uploadedImage.value) {
    await router.replace('/')
    return
  }
  selected.value = true
  running.value = true
  percent.value = 0
  stage.value = stageLabel('loading model')
  localResult.value = null
  error.value = null // Clear any previous errors
  try {
    const out = await removeBg(
      uploadedImage.value,
      (s, p) => {
        stage.value = stageLabel(s)
        if (typeof p === 'number') percent.value = Math.max(0, Math.min(100, Math.round(p)))
      },
      backend.value === 'chroma'
        ? { backend: 'chroma', chroma: {
            color: chroma.color,
            tolerance: chroma.tolerance,
            softness: chroma.softness,
            minRemoveArea: chroma.minRemoveArea,
            minKeepArea: chroma.minKeepArea,
            edgeRadius: chroma.edgeRadius,
            edgeExtraTolerance: chroma.edgeExtraTolerance
          } }
         : { backend: backend.value }
    )
    localResult.value = out
    mattedImage.value = out
    percent.value = 100
    stage.value = stageLabel('done')
  } catch (e) {
    // error ref already set
    console.error('Processing error:', e)
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

function goToCut() { router.push('/cut') }
function backHome() { router.push('/') }
</script>

<template>
  <div class="process-page">
    <n-card title="AI 去背景" size="large" class="panel">
      <div v-if="!uploadedImage" class="center">
        <n-result status="404" title="没有可处理的图片" description="请先上传图片">
          <template #footer>
            <n-button @click="backHome">返回上传</n-button>
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
                  <n-radio value="chroma">纯色抠图</n-radio>
                  <n-radio value="chroma-anime">动漫图抠图</n-radio>
                </n-radio-group>
              </template>
              <template v-else>
                <n-tag type="primary" size="small" style="margin-left: 8px;">
                  已选择：{{
                    backend === 'transformers' ? 'RMBG（Transformers）' :
                    backend === 'imgly' ? 'IMG.LY' :
                    backend === 'chroma-anime' ? '动漫图抠图' :
                    '纯色抠图'
                  }}
                </n-tag>
              </template>
            </div>
            <div>
              <n-space v-if="!selected" align="center">
                <n-button type="primary" :loading="running || loading" @click="startProcess">开始处理</n-button>
                <n-button v-if="backend === 'chroma'" tertiary @click="() => router.push('/chroma')">实时预览</n-button>
                <n-button v-if="backend === 'chroma-anime'" tertiary @click="() => router.push('/chroma-anime')">实时预览</n-button>
              </n-space>
              <n-space v-else align="center">
                <n-button tertiary size="small" :disabled="running || loading" @click="reselectBackend">重选模型</n-button>
                <n-button tertiary size="small" :loading="running || loading" @click="startProcess">重试当前后端</n-button>
                <n-button v-if="backend === 'chroma'" size="small" @click="() => router.push('/chroma')">实时预览</n-button>
                <n-button v-if="backend === 'chroma-anime'" size="small" @click="() => router.push('/chroma-anime')">实时预览</n-button>
              </n-space>
            </div>
          </n-space>
          <div v-if="!selected && backend === 'chroma'" style="margin-top: 12px;">
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
                  <n-slider v-model:value="chroma.edgeRadius" :min="0" :max="8" :step="1" />
                </n-space>
                <n-space vertical>
                  <n-text depth="3">边缘额外容差：{{ chroma.edgeExtraTolerance }}</n-text>
                  <n-slider v-model:value="chroma.edgeExtraTolerance" :min="0" :max="100" :step="1" />
                </n-space>
                <n-text depth="3">提示：选择需要被去除的背景色（如纯绿幕），调高容差可扩大相近色范围，软过渡可减少边缘硬度。</n-text>
                <n-text depth="3">进阶：对连续很小的匹配区域不去除，对连续很小的保留区域直接去除，并只在前景边缘附近扩大容差以抑制毛边。</n-text>
              </n-space>
            </n-card>
          </div>
        </div>

        <div v-if="running || loading" class="progress">
          <n-progress type="line" :percentage="percent" indicator-placement="inside" processing :height="18" />
          <n-text depth="3" style="margin-top: 8px; display:block;">{{ stage }}</n-text>
        </div>

        <div v-if="error" class="mt">
          <n-alert type="error" :title="'处理失败'">{{ error }}</n-alert>
          <div class="actions">
            <n-button type="primary" @click="startProcess">重试</n-button>
            <n-button @click="backHome">返回上传</n-button>
          </div>
        </div>

        <div v-if="localResult && !running && !loading" class="result mt">
          <div class="preview">
            <img :src="localResult" alt="cutout" />
          </div>
          <div class="actions">
            <n-button type="success" @click="downloadResult">下载抠图PNG</n-button>
            <n-button type="primary" @click="goToCut">去裁剪</n-button>
            <n-button @click="backHome">返回上传</n-button>
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