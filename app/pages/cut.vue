<template>
  <div class="cut-page">
    <n-space vertical size="large">
      <n-alert type="info" title="裁剪为正方形">
        请拖动或缩放裁剪框（四角小点），选择正方形区域；裁剪框不会超出图片范围。
      </n-alert>

      <div v-if="!imageSrc" class="no-image">
        <n-result status="404" title="未找到图片" description="请先上传图片">
          <template #footer>
            <n-button type="primary" @click="router.push('/')">返回上传页面</n-button>
          </template>
        </n-result>
      </div>

      <n-grid v-else cols="1 900:2" x-gap="16" y-gap="16">
        <n-grid-item>
          <n-card title="裁剪区域" size="small" :bordered="true">
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

            <n-form label-placement="left" label-width="auto" class="controls">
              <n-form-item label="裁剪框大小">
                <n-slider v-model:value="cropSize" :min="50" :max="maxCropSize" :step="10" />
                <n-text depth="3" style="margin-left: 8px">{{ cropSize }}px</n-text>
              </n-form-item>
              <n-form-item label="图片缩放">
                <n-slider v-model:value="scale" :min="0.1" :max="3" :step="0.1" />
                <n-text depth="3" style="margin-left: 8px">{{ Math.round(scale * 100) }}%</n-text>
              </n-form-item>
            </n-form>
          </n-card>
        </n-grid-item>

        <n-grid-item>
          <n-card title="预览" size="small" :bordered="true">
            <div class="preview-container">
              <canvas ref="previewCanvas" class="preview-canvas"></canvas>
            </div>
            <n-space vertical>
              <n-space>
                <n-button type="primary" @click="cropImage" :disabled="!imageLoaded">裁剪图片</n-button>
                <n-button type="success" @click="downloadImage" :disabled="!croppedImageData">下载图片</n-button>
              </n-space>
              <n-space>
                <n-button @click="reset">重置</n-button>
                <n-button quaternary @click="router.push('/')">返回上传</n-button>
              </n-space>
            </n-space>
          </n-card>
        </n-grid-item>
      </n-grid>
    </n-space>
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

// Canvas绘制信息
let canvasInfo = { x: 0, y: 0, width: 0, height: 0, imageWidth: 0, imageHeight: 0, imageX: 0, imageY: 0 }

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
  imageCanvas.value.width = canvasWidth
  imageCanvas.value.height = canvasHeight

  // 预览
  previewCanvas.value.width = 300
  previewCanvas.value.height = 300

  ctx = imageCanvas.value.getContext('2d')
  previewCtx = previewCanvas.value.getContext('2d')

  maxCropSize.value = Math.min(canvasWidth, canvasHeight, 500)
  cropSize.value = Math.min(200, maxCropSize.value)

  updateCanvasInfo()

  const initialLeft = (canvasWidth - cropSize.value) / 2
  const initialTop = (canvasHeight - cropSize.value) / 2
  cropBoxStyle.value = { width: `${cropSize.value}px`, height: `${cropSize.value}px`, left: `${initialLeft}px`, top: `${initialTop}px` }
}

// 更新Canvas信息
const updateCanvasInfo = () => {
  if (!imageCanvas.value) return
  const canvas = imageCanvas.value
  const rect = canvas.getBoundingClientRect()
  const containerRect = cropContainer.value.getBoundingClientRect()
  canvasInfo.x = rect.left - containerRect.left
  canvasInfo.y = rect.top - containerRect.top
  canvasInfo.width = canvas.width
  canvasInfo.height = canvas.height

  const imageRatio = image.width / image.height
  let drawWidth, drawHeight
  if (imageRatio > 1) {
    drawWidth = canvas.width
    drawHeight = drawWidth / imageRatio
  } else {
    drawHeight = canvas.height
    drawWidth = drawHeight * imageRatio
  }

  // 添加缩放后的实际显示尺寸和位置
  canvasInfo.imageWidth = drawWidth
  canvasInfo.imageHeight = drawHeight
  canvasInfo.imageX = (canvas.width - drawWidth) / 2
  canvasInfo.imageY = (canvas.height - drawHeight) / 2

  // 缩放后的实际显示尺寸
  canvasInfo.scaledWidth = drawWidth * scale.value
  canvasInfo.scaledHeight = drawHeight * scale.value
  canvasInfo.scaledX = (canvas.width - canvasInfo.scaledWidth) / 2
  canvasInfo.scaledY = (canvas.height - canvasInfo.scaledHeight) / 2
}

// 绘制图片到Canvas
const drawImage = () => {
  if (!ctx || !image) return
  ctx.clearRect(0, 0, imageCanvas.value.width, imageCanvas.value.height)

  // 使用更新后的缩放信息
  const { scaledX, scaledY, scaledWidth, scaledHeight } = canvasInfo
  ctx.save()
  ctx.drawImage(image, scaledX, scaledY, scaledWidth, scaledHeight)
  ctx.restore()
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

// 处理拖动/缩放
const handleDrag = (e) => {
  if (!isDragging && !isResizing) return
  if (isDragging) {
    const deltaX = e.clientX - dragStartX
    const deltaY = e.clientY - dragStartY
    let newX = cropBoxStartX + deltaX
    let newY = cropBoxStartY + deltaY
    const size = Number.parseInt(cropBoxStyle.value.width)

    // 限制在图片显示区域内
    const { scaledX, scaledY, scaledWidth, scaledHeight } = canvasInfo
    newX = Math.max(scaledX, Math.min(newX, scaledX + scaledWidth - size))
    newY = Math.max(scaledY, Math.min(newY, scaledY + scaledHeight - size))

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

// 裁剪图片
const cropImage = () => {
  if (!image || !previewCtx) return

  const cropX = Number.parseInt(cropBoxStyle.value.left)
  const cropY = Number.parseInt(cropBoxStyle.value.top)
  const cropSizeValue = Number.parseInt(cropBoxStyle.value.width)

  // 正确计算缩放比例和裁剪区域
  const { scaledX, scaledY, scaledWidth, scaledHeight } = canvasInfo

  // 确保裁剪框在图片显示区域内
  const effectiveCropX = Math.max(0, cropX - scaledX)
  const effectiveCropY = Math.max(0, cropY - scaledY)
  const effectiveCropSize = Math.min(
      cropSizeValue,
      scaledWidth - effectiveCropX,
      scaledHeight - effectiveCropY
  )

  if (effectiveCropSize <= 0) {
    console.error('裁剪区域无效')
    return
  }

  // 计算原始图片坐标
  const scaleX = image.width / scaledWidth
  const scaleY = image.height / scaledHeight
  const srcX = effectiveCropX * scaleX
  const srcY = effectiveCropY * scaleY
  const srcSize = effectiveCropSize * Math.min(scaleX, scaleY)

  const tempCanvas = document.createElement('canvas')
  tempCanvas.width = srcSize
  tempCanvas.height = srcSize
  const tempCtx = tempCanvas.getContext('2d')

  // 高质量图片绘制
  tempCtx.imageSmoothingEnabled = true
  tempCtx.imageSmoothingQuality = 'high'
  tempCtx.drawImage(image, srcX, srcY, srcSize, srcSize, 0, 0, srcSize, srcSize)

  // 预览绘制
  previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height)
  previewCtx.imageSmoothingEnabled = true
  previewCtx.imageSmoothingQuality = 'high'
  previewCtx.drawImage(tempCanvas, 0, 0, srcSize, srcSize, 0, 0, previewCanvas.value.width, previewCanvas.value.height)

  croppedImageData.value = tempCanvas.toDataURL('image/png')
  croppedImage.value = croppedImageData.value
}

const downloadImage = () => { if (croppedImageData.value) { const link = document.createElement('a'); link.download = 'cropped-image.png'; link.href = croppedImageData.value; link.click() } }

const reset = () => {
  scale.value = 1
  // 使用缩放后的图片显示区域来计算初始位置
  const { scaledX, scaledY, scaledWidth, scaledHeight } = canvasInfo
  const initialLeft = scaledX + (scaledWidth - cropSize.value) / 2
  const initialTop = scaledY + (scaledHeight - cropSize.value) / 2
  cropBoxStyle.value = {
    width: `${cropSize.value}px`,
    height: `${cropSize.value}px`,
    left: `${initialLeft}px`,
    top: `${initialTop}px`
  }
  if (previewCtx) previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height)
  croppedImageData.value = null
  croppedImage.value = null
  drawImage()
}

const handleResize = () => { if (imageLoaded.value) { initCanvas(); drawImage() } }

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
.cut-page {
  padding: 16px;
}

.no-image {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 50vh;
}

.crop-container {
  position: relative;
  width: 100%;
  height: 400px;
  border: 1px solid #ddd;
  border-radius: 5px;
  margin-bottom: 20px;
  overflow: hidden;
}

.image-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
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
  background: #4b6cb7;
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
  margin-top: 12px;
}

.preview-container {
  width: 100%;
  height: 320px;
  border: 1px solid rgba(127, 127, 127, .3);
  border-radius: 8px;
  margin-bottom: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
</style>