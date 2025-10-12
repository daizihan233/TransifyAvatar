<template>
  <div class="cut-container">
    <div v-if="!imageSrc" class="no-image">
      <n-result status="404" title="未找到图片" description="请先上传图片">
        <template #footer>
          <n-button @click="router.push('/')">返回上传页面</n-button>
        </template>
      </n-result>
    </div>

    <div v-else class="cut-content">
      <div class="main-content">
        <div class="crop-section">
          <div class="section-title">裁剪区域</div>
          <div class="crop-container" ref="cropContainer">
            <canvas ref="imageCanvas" class="image-canvas"></canvas>
            <div
                ref="cropBox"
                class="crop-box"
                :style="cropBoxStyle"
                @mousedown="startDrag"
            >
              <div class="crop-handle crop-handle-tl" @mousedown.stop="startResize('tl', $event)"></div>
              <div class="crop-handle crop-handle-tr" @mousedown.stop="startResize('tr', $event)"></div>
              <div class="crop-handle crop-handle-bl" @mousedown.stop="startResize('bl', $event)"></div>
              <div class="crop-handle crop-handle-br" @mousedown.stop="startResize('br', $event)"></div>
            </div>
          </div>

          <div class="controls">
            <div class="control-group">
              <n-text>裁剪框大小: {{ cropSize }}px</n-text>
              <n-slider v-model:value="cropSize" :min="50" :max="maxCropSize" :step="10" />
            </div>

            <div class="control-group">
              <n-text>图片缩放: {{ Math.round(scale * 100) }}%</n-text>
              <n-slider v-model:value="scale" :min="0.1" :max="3" :step="0.1" />
            </div>
          </div>
        </div>

        <div class="preview-section">
          <div class="section-title">预览</div>
          <div class="preview-container">
            <canvas ref="previewCanvas" class="preview-canvas"></canvas>
          </div>

          <div class="action-buttons">
            <n-button type="primary" @click="cropImage" :disabled="!imageLoaded">裁剪图片</n-button>
            <n-button type="success" @click="downloadImage" :disabled="!croppedImageData">下载图片</n-button>
            <n-button @click="reset">重置</n-button>
            <n-button @click="router.push('/')">返回上传</n-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useUploadedImage } from '~~/composables/useUploadedImage.js';

const router = useRouter()
const { uploadedImage, croppedImage } = useUploadedImage()

// Refs
const imageCanvas = ref(null)
const previewCanvas = ref(null)
const cropBox = ref(null)
const cropContainer = ref(null)

// 响应式数据
const imageSrc = ref(uploadedImage.value || '')
const imageLoaded = ref(false)
const croppedImageData = ref(null)
const scale = ref(1)
const cropSize = ref(200)
const maxCropSize = ref(300)

// 裁剪框位置和状态
const cropBoxStyle = ref({ width: '200px', height: '200px', left: '100px', top: '100px' })

// 图片和Canvas上下文
let image = null
let ctx = null
let previewCtx = null

// Drag/resize state
let isDragging = false
let isResizing = false
let resizeHandle = '' // 'tl' | 'tr' | 'bl' | 'br'
let dragStartX = 0
let dragStartY = 0
let cropBoxStartX = 0
let cropBoxStartY = 0
let cropBoxStartSize = 0
const minCropSize = 50
let suppressCropSizeWatch = false

// Canvas绘制信息（区分 CSS 尺寸 与 画布内像素尺寸）
let canvasInfo = { x: 0, y: 0, width: 0, height: 0, cssScaleX: 1, cssScaleY: 1, imageWidth: 0, imageHeight: 0, imageX: 0, imageY: 0 }

// 监听图片数据变化
watch(uploadedImage, (newVal) => {
  if (newVal) {
    imageSrc.value = newVal
    nextTick(() => loadImage())
  }
})

// 组件挂载时初始化
onMounted(() => {
  if (imageSrc.value) loadImage()
  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', stopDrag)
  window.addEventListener('resize', handleResize)
})

// 组件卸载时清理
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', stopDrag)
  window.removeEventListener('resize', handleResize)
})

// 加载图片
const loadImage = () => {
  if (!imageSrc.value) return
  image = new Image()
  image.onload = () => { imageLoaded.value = true; initCanvas(); drawImage() }
  image.onerror = () => { console.error('图片加载失败') }
  image.src = imageSrc.value
}

// 初始化Canvas
const initCanvas = () => {
  if (!imageCanvas.value || !previewCanvas.value) return
  const container = cropContainer.value
  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight

  const imageRatio = image.width / image.height
  let canvasWidth, canvasHeight
  if (imageRatio > 1) {
    canvasWidth = Math.min(containerWidth, image.width)
    canvasHeight = canvasWidth / imageRatio
  } else {
    canvasHeight = Math.min(containerHeight, image.height)
    canvasWidth = canvasHeight * imageRatio
  }

  // 设置画布的内部像素尺寸（同时也作为元素的自然渲染尺寸）
  imageCanvas.value.width = Math.max(1, Math.round(canvasWidth))
  imageCanvas.value.height = Math.max(1, Math.round(canvasHeight))

  // 预览固定 300x300
  previewCanvas.value.width = 300
  previewCanvas.value.height = 300

  ctx = imageCanvas.value.getContext('2d')
  previewCtx = previewCanvas.value.getContext('2d')

  updateCanvasInfo()

  maxCropSize.value = Math.min(canvasInfo.width, canvasInfo.height, 500)
  cropSize.value = Math.min(200, maxCropSize.value)

  const initialLeft = (canvasInfo.width - cropSize.value) / 2
  const initialTop = (canvasInfo.height - cropSize.value) / 2
  cropBoxStyle.value = { width: `${cropSize.value}px`, height: `${cropSize.value}px`, left: `${initialLeft}px`, top: `${initialTop}px` }
}

// 更新Canvas信息（使用 CSS 尺寸，确保与裁剪框一致）
const updateCanvasInfo = () => {
  if (!imageCanvas.value || !cropContainer.value) return
  const canvas = imageCanvas.value
  const rect = canvas.getBoundingClientRect()
  const containerRect = cropContainer.value.getBoundingClientRect()
  canvasInfo.x = rect.left - containerRect.left
  canvasInfo.y = rect.top - containerRect.top
  canvasInfo.width = rect.width
  canvasInfo.height = rect.height

  // CSS 到 画布内部像素的缩放比例（通常相同，但保留以避免样式差异）
  canvasInfo.cssScaleX = rect.width / (canvas.width || 1)
  canvasInfo.cssScaleY = rect.height / (canvas.height || 1)

  const imageRatio = image.width / image.height
  let drawWidth, drawHeight
  if (imageRatio > 1) {
    drawWidth = canvas.width
    drawHeight = drawWidth / imageRatio
  } else {
    drawHeight = canvas.height
    drawWidth = drawHeight * imageRatio
  }
  canvasInfo.imageWidth = drawWidth
  canvasInfo.imageHeight = drawHeight
  canvasInfo.imageX = (canvas.width - drawWidth) / 2
  canvasInfo.imageY = (canvas.height - drawHeight) / 2
}

// 绘制图片到Canvas（仅用于可视化；源数据始终来自原图像）
const drawImage = () => {
  if (!ctx || !image) return
  ctx.clearRect(0, 0, imageCanvas.value.width, imageCanvas.value.height)
  const scaledWidth = canvasInfo.imageWidth * scale.value
  const scaledHeight = canvasInfo.imageHeight * scale.value
  const x = (imageCanvas.value.width - scaledWidth) / 2
  const y = (imageCanvas.value.height - scaledHeight) / 2
  ctx.save(); ctx.drawImage(image, x, y, scaledWidth, scaledHeight); ctx.restore()
}

// 开始拖动
const startDrag = (e) => {
  if (isResizing) return
  e.preventDefault(); isDragging = true
  dragStartX = e.clientX; dragStartY = e.clientY
  cropBoxStartX = Number.parseInt(cropBoxStyle.value.left)
  cropBoxStartY = Number.parseInt(cropBoxStyle.value.top)
  if (cropBox.value) cropBox.value.style.cursor = 'grabbing'
}

// 开始调整大小
function startResize(handle, e) {
  e.preventDefault(); isResizing = true; resizeHandle = handle
  dragStartX = e.clientX; dragStartY = e.clientY
  cropBoxStartX = Number.parseInt(cropBoxStyle.value.left)
  cropBoxStartY = Number.parseInt(cropBoxStyle.value.top)
  cropBoxStartSize = Number.parseInt(cropBoxStyle.value.width)
  if (cropBox.value) {
    const cursorMap = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize' }
    cropBox.value.style.cursor = cursorMap[handle] || 'default'
  }
}

// 处理拖动/缩放（使用 CSS 尺寸，约束在 canvas 可视区域内）
const handleDrag = (e) => {
  if (!isDragging && !isResizing) return
  if (isDragging) {
    const deltaX = e.clientX - dragStartX
    const deltaY = e.clientY - dragStartY
    let newX = cropBoxStartX + deltaX
    let newY = cropBoxStartY + deltaY
    const size = Number.parseInt(cropBoxStyle.value.width)
    newX = Math.max(0, Math.min(newX, canvasInfo.width - size))
    newY = Math.max(0, Math.min(newY, canvasInfo.height - size))
    cropBoxStyle.value = { ...cropBoxStyle.value, left: `${newX}px`, top: `${newY}px` }
    return
  }
  // Resize path
  const containerRect = cropContainer.value.getBoundingClientRect()
  const mouseX = e.clientX - containerRect.left
  const mouseY = e.clientY - containerRect.top
  const maxSize = Math.min(maxCropSize.value, canvasInfo.width, canvasInfo.height)

  let newLeft = cropBoxStartX
  let newTop = cropBoxStartY
  let newSize = cropBoxStartSize

  switch (resizeHandle) {
    case 'tl': {
      const anchorX = cropBoxStartX + cropBoxStartSize
      const anchorY = cropBoxStartY + cropBoxStartSize
      const candSize = Math.min(
          anchorX - Math.max(0, Math.min(mouseX, anchorX)),
          anchorY - Math.max(0, Math.min(mouseY, anchorY))
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize))
      newLeft = Math.max(0, anchorX - newSize)
      newTop = Math.max(0, anchorY - newSize)
      break
    }
    case 'tr': {
      const anchorX = cropBoxStartX
      const anchorY = cropBoxStartY + cropBoxStartSize
      const candSize = Math.min(
          Math.max(0, Math.min(mouseX, canvasInfo.width)) - anchorX,
          anchorY - Math.max(0, Math.min(mouseY, anchorY))
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize, canvasInfo.width - anchorX))
      newLeft = anchorX
      newTop = Math.max(0, anchorY - newSize)
      break
    }
    case 'bl': {
      const anchorX = cropBoxStartX + cropBoxStartSize
      const anchorY = cropBoxStartY
      const candSize = Math.min(
          anchorX - Math.max(0, Math.min(mouseX, anchorX)),
          Math.max(0, Math.min(mouseY, canvasInfo.height)) - anchorY
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize, anchorX))
      newLeft = Math.max(0, anchorX - newSize)
      newTop = anchorY
      break
    }
    case 'br': {
      const anchorX = cropBoxStartX
      const anchorY = cropBoxStartY
      const candSize = Math.min(
          Math.max(0, Math.min(mouseX, canvasInfo.width)) - anchorX,
          Math.max(0, Math.min(mouseY, canvasInfo.height)) - anchorY
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize, canvasInfo.width - anchorX, canvasInfo.height - anchorY))
      newLeft = anchorX
      newTop = anchorY
      break
    }
  }
  newLeft = Math.max(0, Math.min(newLeft, canvasInfo.width - newSize))
  newTop = Math.max(0, Math.min(newTop, canvasInfo.height - newSize))
  suppressCropSizeWatch = true
  cropSize.value = Math.round(newSize)
  cropBoxStyle.value = { width: `${cropSize.value}px`, height: `${cropSize.value}px`, left: `${Math.round(newLeft)}px`, top: `${Math.round(newTop)}px` }
  suppressCropSizeWatch = false
}

// 停止拖动
const stopDrag = () => { isDragging = false; isResizing = false; resizeHandle = ''; if (cropBox.value) cropBox.value.style.cursor = 'grab' }

// 裁剪图片（基于原图像像素进行裁剪）
const cropImage = () => {
  if (!image || !previewCtx || !imageCanvas.value) return

  // 裁剪框（CSS 像素）
  const cropXCss = Number.parseInt(cropBoxStyle.value.left)
  const cropYCss = Number.parseInt(cropBoxStyle.value.top)
  const cropSizeCss = Number.parseInt(cropBoxStyle.value.width)

  // 将 CSS 坐标转换为画布内部像素坐标
  const rect = imageCanvas.value.getBoundingClientRect()
  const cssToCanvasScaleX = (imageCanvas.value.width || 1) / (rect.width || 1)
  const cssToCanvasScaleY = (imageCanvas.value.height || 1) / (rect.height || 1)
  const cropXCanvas = cropXCss * cssToCanvasScaleX
  const cropYCanvas = cropYCss * cssToCanvasScaleY
  const cropSizeCanvas = cropSizeCss * ((cssToCanvasScaleX + cssToCanvasScaleY) / 2)

  // 计算画布中已缩放后的图片相对位置（画布内部像素）
  const displayedImgW = canvasInfo.imageWidth * scale.value
  const displayedImgH = canvasInfo.imageHeight * scale.value
  const displayedImgX = (imageCanvas.value.width - displayedImgW) / 2
  const displayedImgY = (imageCanvas.value.height - displayedImgH) / 2

  // 裁剪框与图片显示区域的相对关系（画布内部像素）
  const relativeX = cropXCanvas - displayedImgX
  const relativeY = cropYCanvas - displayedImgY

  // 将画布内部像素映射到原图像像素
  const scaleXToSrc = image.width / displayedImgW
  const scaleYToSrc = image.height / displayedImgH
  const srcX = Math.max(0, Math.floor(relativeX * scaleXToSrc))
  const srcY = Math.max(0, Math.floor(relativeY * scaleYToSrc))
  const srcSize = Math.max(1, Math.floor(Math.min(
    cropSizeCanvas * scaleXToSrc,
    cropSizeCanvas * scaleYToSrc,
    image.width - srcX,
    image.height - srcY
  )))

  // 在离屏画布上基于原图裁剪
  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = srcSize
  tempCanvas.height = srcSize
  const tempCtx = tempCanvas.getContext('2d')
  tempCtx.drawImage(image, srcX, srcY, srcSize, srcSize, 0, 0, srcSize, srcSize)

  // 更新右侧预览（缩放到 300x300 但不会影响下载质量）
  previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height)
  previewCtx.drawImage(tempCanvas, 0, 0, srcSize, srcSize, 0, 0, previewCanvas.value.width, previewCanvas.value.height)

  // 存储基于原图像素的裁剪结果
  croppedImageData.value = tempCanvas.toDataURL('image/png')
  croppedImage.value = croppedImageData.value
}

const downloadImage = () => { if (croppedImageData.value) { const link = document.createElement('a'); link.download = 'cropped-image.png'; link.href = croppedImageData.value; link.click() } }

const reset = () => {
  scale.value = 1
  const initialLeft = (canvasInfo.width - cropSize.value) / 2
  const initialTop = (canvasInfo.height - cropSize.value) / 2
  cropBoxStyle.value = { width: `${cropSize.value}px`, height: `${cropSize.value}px`, left: `${initialLeft}px`, top: `${initialTop}px` }
  if (previewCtx) previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height)
  croppedImageData.value = null; croppedImage.value = null
  updateCanvasInfo()
  drawImage()
}

const handleResize = () => { if (imageLoaded.value) { updateCanvasInfo(); initCanvas(); drawImage() } }

watch(scale, () => { if (imageLoaded.value) drawImage() })

watch(cropSize, () => {
  if (suppressCropSizeWatch) return
  const currentLeft = Number.parseInt(cropBoxStyle.value.left)
  const currentTop = Number.parseInt(cropBoxStyle.value.top)
  const currentCenterX = currentLeft + Number.parseInt(cropBoxStyle.value.width) / 2
  const currentCenterY = currentTop + Number.parseInt(cropBoxStyle.value.height) / 2
  const newLeft = Math.max(0, Math.min(currentCenterX - cropSize.value / 2, canvasInfo.width - cropSize.value))
  const newTop = Math.max(0, Math.min(currentCenterY - cropSize.value / 2, canvasInfo.height - cropSize.value))
  cropBoxStyle.value = { width: `${cropSize.value}px`, height: `${cropSize.value}px`, left: `${newLeft}px`, top: `${newTop}px` }
})
</script>

<style scoped>
.cut-container {
  min-height: 100vh;
  padding: 20px;
}

.no-image {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 80vh;
}

.cut-content {
  max-width: 1200px;
  margin: 0 auto;
  border-radius: 15px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.header h1 {
  font-size: 2.2rem;
  margin-bottom: 10px;
}

.header p {
  font-size: 1.1rem;
  opacity: 0.9;
}

.main-content {
  display: flex;
  flex-wrap: wrap;
  padding: 20px;
  gap: 20px;
}

.crop-section {
  flex: 1;
  min-width: 500px;
}

.preview-section {
  flex: 0 0 350px;
}

.section-title {
  font-size: 1.3rem;
  margin-bottom: 15px;
  color: #4b6cb7;
  border-bottom: 2px solid #4b6cb7;
  padding-bottom: 5px;
}

.crop-container {
  position: relative;
  width: 100%;
  height: 400px;
  border: 1px solid #ddd;
  border-radius: 5px;
  margin-bottom: 20px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-canvas {
  /* 不强制拉伸到容器，使用画布自身尺寸显示，避免 CSS/像素不一致 */
  display: block;
  max-width: 100%;
  max-height: 100%;
}

.crop-box {
  position: absolute;
  border: 2px solid #4b6cb7;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3);
  cursor: grab;
  z-index: 10;
}

.crop-box:active {
  cursor: grabbing;
}

.crop-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid white;
}

.crop-handle-tl {
  top: -5px;
  left: -5px;
  cursor: nw-resize;
}

.crop-handle-tr {
  top: -5px;
  right: -5px;
  cursor: ne-resize;
}

.crop-handle-bl {
  bottom: -5px;
  left: -5px;
  cursor: sw-resize;
}

.crop-handle-br {
  bottom: -5px;
  right: -5px;
  cursor: se-resize;
}

.controls {
  padding: 15px;
  border-radius: 5px;
}

.control-group {
  margin-bottom: 20px;
}

.control-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: #333;
}

.preview-container {
  width: 100%;
  height: 300px;
  border: 1px solid #ddd;
  border-radius: 5px;
  margin-bottom: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@media (max-width: 768px) {
  .main-content {
    flex-direction: column;
  }

  .crop-section, .preview-section {
    min-width: 100%;
  }

  .crop-container {
    height: 300px;
  }

  .preview-container {
    height: 250px;
  }
}
</style>