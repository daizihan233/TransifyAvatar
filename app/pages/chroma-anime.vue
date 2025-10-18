<script setup lang="ts">
import { ref, reactive, watch, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadedImage } from '~~/composables/useUploadedImage'
import { useMatting } from '~~/composables/useMatting'

const router = useRouter()
const { uploadedImage, mattedImage } = useUploadedImage()
const { removeBg, loading, error } = useMatting()

// Params
const chromaAnime = reactive({
  color: '#ffffff',
  tolerance: 3,
  minKeepArea: 100,
  useHsv: true,
  autoSample: true,
  edgeThreshold: 30,
  erosionTolerance: 1.5,
  floodFillStrength: 0.5,
  complexStructureThreshold: 3,
  edgePrecision: 2,
  minEnclosedArea: 240,
  // 🎯 高级参数：复杂度分析权重
  complexityWeights: {
    angleChange: 35,
    stdDev: 35,
    perimeterArea: 20,
    circularity: 10
  },
  maxEnclosedAreaForComplexity: 40,  // 9999 表示不限制
  perimeterAreaNormalizer: 10
})

const previewUrl = ref<string | null>(null)
const running = ref(false)
const darkBg = ref(true)
const showAdvanced = ref(false)
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
        { backend: 'chroma-anime', chromaAnime: {
          color: chromaAnime.color,
          tolerance: chromaAnime.tolerance,
          minKeepArea: chromaAnime.minKeepArea,
          useHsv: chromaAnime.useHsv,
          autoSample: chromaAnime.autoSample,
          edgeThreshold: chromaAnime.edgeThreshold,
          erosionTolerance: chromaAnime.erosionTolerance,
          floodFillStrength: chromaAnime.floodFillStrength,
          complexStructureThreshold: chromaAnime.complexStructureThreshold,
          edgePrecision: chromaAnime.edgePrecision,
          minEnclosedArea: chromaAnime.minEnclosedArea,
          // 🎯 传递高级参数
          complexityWeights: {
            angleChange: chromaAnime.complexityWeights.angleChange,
            stdDev: chromaAnime.complexityWeights.stdDev,
            perimeterArea: chromaAnime.complexityWeights.perimeterArea,
            circularity: chromaAnime.complexityWeights.circularity
          },
          maxEnclosedAreaForComplexity: chromaAnime.maxEnclosedAreaForComplexity,
          perimeterAreaNormalizer: chromaAnime.perimeterAreaNormalizer
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
watch(chromaAnime, () => debounceRun(200), { deep: true })

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
  a.download = 'chroma-anime-cutout.png'
  a.click()
}
</script>

<template>
  <div class="chroma-anime-page">
    <n-card title="动漫图抠图 · 实时预览" size="large" class="panel">
      <template #header-extra>
        <n-tag type="success" size="small">智能边缘检测</n-tag>
      </template>

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
                  <n-color-picker v-model:value="chromaAnime.color" :show-alpha="false" :actions="['confirm']" size="small" style="width: 240px;" />
                </n-space>

                <n-divider style="margin: 8px 0;" />

                <n-space vertical>
                  <n-text depth="3">颜色容差：{{ chromaAnime.tolerance }}</n-text>
                  <n-slider v-model:value="chromaAnime.tolerance" :min="0" :max="255" :step="1" />
                  <n-text depth="3" style="font-size: 12px;">控制背景色相似度范围</n-text>
                </n-space>

                <n-space vertical>
                  <n-text depth="3">边缘检测阈值：{{ chromaAnime.edgeThreshold }} <n-text depth="3" v-if="chromaAnime.edgeThreshold === 0" type="warning">(已禁用)</n-text></n-text>
                  <n-slider v-model:value="chromaAnime.edgeThreshold" :min="0" :max="100" :step="1" />
                  <n-text depth="3" style="font-size: 12px;">🔧 设为0禁用边缘检测 | 数值越小越敏感</n-text>
                </n-space>

                <n-space vertical>
                  <n-text depth="3">边缘精度（像素）：{{ chromaAnime.edgePrecision }}</n-text>
                  <n-slider v-model:value="chromaAnime.edgePrecision" :min="1" :max="5" :step="1" />
                  <n-text depth="3" style="font-size: 12px;">边缘腐蚀的搜索范围</n-text>
                </n-space>

                <n-space vertical>
                  <n-text depth="3">去白边强度：{{ chromaAnime.erosionTolerance.toFixed(1) }} <n-text depth="3" v-if="chromaAnime.erosionTolerance === 0" type="warning">(已禁用)</n-text></n-text>
                  <n-slider v-model:value="chromaAnime.erosionTolerance" :min="0" :max="3.0" :step="0.1" />
                  <n-text depth="3" style="font-size: 12px;">🔧 设为0禁用边缘腐蚀 | 数值越大越激进</n-text>
                </n-space>

                <n-space vertical>
                  <n-text depth="3">复杂结构阈值：{{ chromaAnime.complexStructureThreshold }} <n-text depth="3" v-if="chromaAnime.complexStructureThreshold === 0" type="warning">(已禁用)</n-text></n-text>
                  <n-slider v-model:value="chromaAnime.complexStructureThreshold" :min="0" :max="10" :step="1" />
                  <n-text depth="3" style="font-size: 12px;">🔧 设为0禁用复杂结构保护 | 识别镂空和粒子效果</n-text>
                </n-space>

                <n-space vertical>
                  <n-text depth="3">洪水填充强度：{{ chromaAnime.floodFillStrength.toFixed(1) }} <n-text depth="3" v-if="chromaAnime.floodFillStrength < 0" type="warning">(已禁用)</n-text></n-text>
                  <n-slider v-model:value="chromaAnime.floodFillStrength" :min="-1" :max="1" :step="0.1" />
                  <n-text depth="3" style="font-size: 12px;">🔧 设为-1禁用洪水填充 | 控制是否穿越小缝隙</n-text>
                </n-space>

                <n-space vertical>
                  <n-text depth="3">最小保留区域（像素）：{{ chromaAnime.minKeepArea }} <n-text depth="3" v-if="chromaAnime.minKeepArea === 0" type="warning">(已禁用)</n-text></n-text>
                  <n-slider v-model:value="chromaAnime.minKeepArea" :min="0" :max="300" :step="1" />
                  <n-text depth="3" style="font-size: 12px;">🔧 设为0禁用小区域移除 | 小于此面积的碎片将被移除</n-text>
                </n-space>

                <n-space vertical>
                  <n-text depth="3">最小封闭区域（像素）：{{ chromaAnime.minEnclosedArea }} <n-text depth="3" v-if="chromaAnime.minEnclosedArea === 0" type="warning">(已禁用)</n-text></n-text>
                  <n-slider v-model:value="chromaAnime.minEnclosedArea" :min="0" :max="300" :step="1" />
                  <n-text depth="3" style="font-size: 12px;">🔧 设为0禁用封闭区域检测 | 小于此值的封闭透明区域将恢复为前景</n-text>
                </n-space>

                <n-divider style="margin: 8px 0;" />

                <n-space vertical>
                  <n-space align="center">
                    <n-text depth="3">使用 HSV 色彩空间：</n-text>
                    <n-switch v-model:value="chromaAnime.useHsv" />
                  </n-space>
                  <n-space align="center">
                    <n-text depth="3">自动采样背景色：</n-text>
                    <n-switch v-model:value="chromaAnime.autoSample" />
                  </n-space>
                  <n-space align="center">
                    <n-text depth="3">黑底预览：</n-text>
                    <n-switch v-model:value="darkBg" />
                  </n-space>
                </n-space>

                <n-divider style="margin: 8px 0;" />

                <n-space vertical>
                  <n-space align="center">
                    <n-button size="small" @click="showAdvanced = !showAdvanced">
                      <n-icon v-if="!showAdvanced"><Reload /></n-icon>
                      <n-icon v-else><Check /></n-icon>
                      <span v-if="!showAdvanced">显示高级参数</span>
                      <span v-else>隐藏高级参数</span>
                    </n-button>
                  </n-space>

                  <n-collapse v-if="showAdvanced" bordered>
                    <n-collapse-item name="advanced-params" title="复杂度分析高级参数" :is-active="true">
                      <n-space vertical style="width: 100%;">
                        <n-space vertical>
                          <n-text depth="3">复杂度权重 - 角度变化：</n-text>
                          <n-slider v-model:value="chromaAnime.complexityWeights.angleChange" :min="0" :max="100" :step="1" />
                          <n-text depth="3" style="font-size: 12px;">控制角度变化对复杂度的影响</n-text>
                        </n-space>

                        <n-space vertical>
                          <n-text depth="3">复杂度权重 - 标准差：</n-text>
                          <n-slider v-model:value="chromaAnime.complexityWeights.stdDev" :min="0" :max="100" :step="1" />
                          <n-text depth="3" style="font-size: 12px;">控制颜色标准差对复杂度的影响</n-text>
                        </n-space>

                        <n-space vertical>
                          <n-text depth="3">复杂度权重 - 周长面积：</n-text>
                          <n-slider v-model:value="chromaAnime.complexityWeights.perimeterArea" :min="0" :max="100" :step="1" />
                          <n-text depth="3" style="font-size: 12px;">控制周长与面积比对复杂度的影响</n-text>
                        </n-space>

                        <n-space vertical>
                          <n-text depth="3">复杂度权重 - 圆形度：</n-text>
                          <n-slider v-model:value="chromaAnime.complexityWeights.circularity" :min="0" :max="100" :step="1" />
                          <n-text depth="3" style="font-size: 12px;">控制形状圆形度对复杂度的影响</n-text>
                        </n-space>

                        <n-space vertical>
                          <n-text depth="3">最大封闭面积：</n-text>
                          <n-slider v-model:value="chromaAnime.maxEnclosedAreaForComplexity" :min="0" :max="2000" :step="10" />
                          <n-text depth="3" style="font-size: 12px;">🔧 设为0不限制 | 大于此面积的封闭区域直接保持透明</n-text>
                        </n-space>

                        <n-space vertical>
                          <n-text depth="3">周长面积归一化系数：</n-text>
                          <n-slider v-model:value="chromaAnime.perimeterAreaNormalizer" :min="1" :max="50" :step="1" />
                          <n-text depth="3" style="font-size: 12px;">控制周长归一化的强度</n-text>
                        </n-space>
                      </n-space>
                    </n-collapse-item>
                  </n-collapse>
                </n-space>

                <n-alert v-if="error" type="warning">{{ error }}</n-alert>

                <n-space vertical style="width: 100%;">
                  <n-button type="primary" block :disabled="!previewUrl" @click="applyAndBack">应用并返回处理</n-button>
                  <n-button type="info" block :disabled="!previewUrl" @click="applyAndCut">应用并去裁剪</n-button>
                  <n-button block :disabled="!previewUrl" @click="downloadPreview">下载预览PNG</n-button>
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
.chroma-anime-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
.panel { width: min(1100px, 98vw); }
.layout { display: grid; grid-template-columns: 380px 1fr; gap: 16px; }
.preview-box { position: relative; width: 100%; background:
  conic-gradient(#eee 25%, transparent 0) 0 0/20px 20px content-box, #fafafa;
  border: 1px solid #eee; border-radius: 8px; padding: 8px; display:flex; align-items:center; justify-content:center; min-height: 360px; }
.preview-box img { max-width: 100%; height: auto; display: block; }
.overlay { position: absolute; inset: 0; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.5); }
.center { display: flex; align-items: center; justify-content: center; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
</style>
