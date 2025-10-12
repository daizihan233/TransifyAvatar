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
          <div class="crop-container" ref="cropContainer" :style="cropContainerStyle">
            <img :src="imageSrc" alt="uploaded" ref="imageEl" class="image-el" @load="onImageElementLoad" />
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
          </div>
        </div>

        <div class="preview-section">
          <div class="section-title">预览</div>
          <div class="preview-container" ref="previewContainer">
            <canvas ref="previewCanvas" class="preview-canvas"></canvas>
          </div>

          <div class="action-buttons">
            <n-button type="primary" @click="cropImage" :disabled="!imageLoaded">裁剪图片</n-button>
            <n-button type="info" @click="goToProcess" :disabled="!croppedImageData">去背景处理</n-button>
            <n-button type="success" @click="downloadImage" :disabled="!croppedImageData">下载裁剪PNG</n-button>
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
const imageEl = ref(null)
const previewCanvas = ref(null)
const cropBox = ref(null)
const cropContainer = ref(null)
const previewContainer = ref(null)
const cropContainerStyle = ref({})

// 响应式数据
const imageSrc = ref(uploadedImage.value || '')
const imageLoaded = ref(false)
const croppedImageData = ref(null)
const cropSize = ref(200)
const maxCropSize = ref(300)

// 裁剪框位置和状态
const cropBoxStyle = ref({ width: '200px', height: '200px', left: '100px', top: '100px' })

// 图片对象，仅用于读取原始像素
let image = null
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

// 显示中的图片区域（CSS坐标，基于 <img>）
let displayedInfo = { left: 0, top: 0, width: 0, height: 0 }

const getDpr = () => {
  const dpr = (typeof globalThis !== 'undefined' && typeof globalThis.devicePixelRatio === 'number')
    ? Number(globalThis.devicePixelRatio)
    : 1
  return dpr > 0 ? dpr : 1
}

// 监听图片数据变化
watch(uploadedImage, (newVal) => {
  if (newVal) {
    imageSrc.value = newVal
    nextTick(() => loadImage())
  }
})

onMounted(() => {
  if (imageSrc.value) loadImage()
  document.addEventListener('mousemove', handleDrag)
  document.addEventListener('mouseup', stopDrag)
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousemove', handleDrag)
  document.removeEventListener('mouseup', stopDrag)
  window.removeEventListener('resize', handleResize)
})

// 加载原图（仅用于最终裁剪）
const loadImage = () => {
  if (!imageSrc.value) return
  image = new Image()
  image.onload = () => {
    imageLoaded.value = true
    cropContainerStyle.value = { aspectRatio: `${image.width} / ${image.height}` }
    // 预览上下文
    if (previewCanvas.value) {
      previewCtx = previewCanvas.value.getContext('2d')
      if (previewCtx) { previewCtx.imageSmoothingEnabled = true; previewCtx.imageSmoothingQuality = 'high' }
      initPreviewCanvas()
    }
    // 等待 <img> 布局后计算显示区域
    nextTick(() => { updateDisplayedInfo(); centerCropBox() })
  }
  image.onerror = () => { console.error('图片加载失败') }
  image.src = imageSrc.value
}

const onImageElementLoad = () => {
  // <img> 渲染完成后，更新显示区域与裁剪框
  updateDisplayedInfo()
  centerCropBox()
}

const initPreviewCanvas = () => {
  if (!previewCanvas.value || !previewContainer.value) return
  const rect = previewContainer.value.getBoundingClientRect()
  const dpr = getDpr()
  previewCanvas.value.width = Math.max(1, Math.round(rect.width)) * dpr
  previewCanvas.value.height = Math.max(1, Math.round(rect.height)) * dpr
}

const updateDisplayedInfo = () => {
  if (!imageEl.value || !cropContainer.value) return
  const imgRect = imageEl.value.getBoundingClientRect()
  const containerRect = cropContainer.value.getBoundingClientRect()
  displayedInfo.left = imgRect.left - containerRect.left
  displayedInfo.top = imgRect.top - containerRect.top
  displayedInfo.width = imgRect.width
  displayedInfo.height = imgRect.height
  maxCropSize.value = Math.floor(Math.min(displayedInfo.width, displayedInfo.height))
}

const centerCropBox = () => {
  const size = Math.min(200, maxCropSize.value)
  const left = displayedInfo.left + (displayedInfo.width - size) / 2
  const top = displayedInfo.top + (displayedInfo.height - size) / 2
  cropSize.value = size
  cropBoxStyle.value = { width: `${size}px`, height: `${size}px`, left: `${left}px`, top: `${top}px` }
}

// 拖动/缩放裁剪框（限制在图片显示区域）
const handleDrag = (e) => {
  if (!isDragging && !isResizing) return
  const minX = displayedInfo.left
  const minY = displayedInfo.top
  const maxXLimit = displayedInfo.left + displayedInfo.width
  const maxYLimit = displayedInfo.top + displayedInfo.height

  if (isDragging) {
    const deltaX = e.clientX - dragStartX
    const deltaY = e.clientY - dragStartY
    let newX = cropBoxStartX + deltaX
    let newY = cropBoxStartY + deltaY
    const size = Number.parseInt(cropBoxStyle.value.width)
    newX = Math.max(minX, Math.min(newX, maxXLimit - size))
    newY = Math.max(minY, Math.min(newY, maxYLimit - size))
    cropBoxStyle.value = { ...cropBoxStyle.value, left: `${newX}px`, top: `${newY}px` }
    return
  }

  const containerRect = cropContainer.value.getBoundingClientRect()
  const mouseX = e.clientX - containerRect.left
  const mouseY = e.clientY - containerRect.top
  const maxSizeByBounds = Math.min(displayedInfo.width, displayedInfo.height)
  const maxSize = Math.min(maxCropSize.value, maxSizeByBounds)

  let newLeft = cropBoxStartX
  let newTop = cropBoxStartY
  let newSize = cropBoxStartSize

  switch (resizeHandle) {
    case 'tl': {
      const anchorX = cropBoxStartX + cropBoxStartSize
      const anchorY = cropBoxStartY + cropBoxStartSize
      const candSize = Math.min(
        anchorX - Math.max(minX, Math.min(mouseX, anchorX)),
        anchorY - Math.max(minY, Math.min(mouseY, anchorY))
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize))
      newLeft = Math.max(minX, anchorX - newSize)
      newTop = Math.max(minY, anchorY - newSize)
      break
    }
    case 'tr': {
      const anchorX = cropBoxStartX
      const anchorY = cropBoxStartY + cropBoxStartSize
      const candSize = Math.min(
        Math.max(minX, Math.min(mouseX, maxXLimit)) - anchorX,
        anchorY - Math.max(minY, Math.min(mouseY, anchorY))
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize, maxXLimit - anchorX))
      newLeft = anchorX
      newTop = Math.max(minY, anchorY - newSize)
      break
    }
    case 'bl': {
      const anchorX = cropBoxStartX + cropBoxStartSize
      const anchorY = cropBoxStartY
      const candSize = Math.min(
        anchorX - Math.max(minX, Math.min(mouseX, anchorX)),
        Math.max(minY, Math.min(mouseY, maxYLimit)) - anchorY
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize, anchorX - minX))
      newLeft = Math.max(minX, anchorX - newSize)
      newTop = anchorY
      break
    }
    case 'br': {
      const anchorX = cropBoxStartX
      const anchorY = cropBoxStartY
      const candSize = Math.min(
        Math.max(minX, Math.min(mouseX, maxXLimit)) - anchorX,
        Math.max(minY, Math.min(mouseY, maxYLimit)) - anchorY
      )
      newSize = Math.max(minCropSize, Math.min(candSize, maxSize, maxXLimit - anchorX, maxYLimit - anchorY))
      newLeft = anchorX
      newTop = anchorY
      break
    }
  }
  newLeft = Math.max(minX, Math.min(newLeft, maxXLimit - newSize))
  newTop = Math.max(minY, Math.min(newTop, maxYLimit - newSize))
  suppressCropSizeWatch = true
  cropSize.value = Math.round(newSize)
  cropBoxStyle.value = { width: `${cropSize.value}px`, height: `${cropSize.value}px`, left: `${Math.round(newLeft)}px`, top: `${Math.round(newTop)}px` }
  suppressCropSizeWatch = false
}

const startDrag = (e) => {
  if (isResizing) return
  e.preventDefault(); isDragging = true
  dragStartX = e.clientX; dragStartY = e.clientY
  cropBoxStartX = Number.parseInt(cropBoxStyle.value.left)
  cropBoxStartY = Number.parseInt(cropBoxStyle.value.top)
  if (cropBox.value) cropBox.value.style.cursor = 'grabbing'
}

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

const stopDrag = () => { isDragging = false; isResizing = false; resizeHandle = ''; if (cropBox.value) cropBox.value.style.cursor = 'grab' }

// 基于原图像素裁剪
const cropImage = () => {
  if (!image || !previewCanvas.value || !previewCtx) return
  const cropXCss = Number.parseInt(cropBoxStyle.value.left)
  const cropYCss = Number.parseInt(cropBoxStyle.value.top)
  const cropSizeCss = Number.parseInt(cropBoxStyle.value.width)

  // 相对显示图像区域
  const relativeX = cropXCss - displayedInfo.left
  const relativeY = cropYCss - displayedInfo.top

  // CSS -> 原图像素映射
  const scaleXToSrc = image.width / displayedInfo.width
  const scaleYToSrc = image.height / displayedInfo.height
  const srcX = Math.max(0, Math.floor(relativeX * scaleXToSrc))
  const srcY = Math.max(0, Math.floor(relativeY * scaleYToSrc))
  const srcSize = Math.max(1, Math.floor(Math.min(
    cropSizeCss * scaleXToSrc,
    cropSizeCss * scaleYToSrc,
    image.width - srcX,
    image.height - srcY
  )))

  const tmp = document.createElement('canvas')
  tmp.width = srcSize
  tmp.height = srcSize
  const tctx = tmp.getContext('2d')
  if (tctx) { tctx.imageSmoothingEnabled = true; tctx.imageSmoothingQuality = 'high' }
  tctx.drawImage(image, srcX, srcY, srcSize, srcSize, 0, 0, srcSize, srcSize)

  // 预览绘制（DPR 清晰）
  const rect = previewContainer.value.getBoundingClientRect()
  const dpr = getDpr()
  previewCanvas.value.width = Math.max(1, Math.round(rect.width)) * dpr
  previewCanvas.value.height = Math.max(1, Math.round(rect.height)) * dpr
  previewCtx.setTransform(1, 0, 0, 1, 0, 0)
  previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height)
  previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  previewCtx.drawImage(tmp, 0, 0, srcSize, srcSize, 0, 0, rect.width, rect.height)

  croppedImageData.value = tmp.toDataURL('image/png')
  croppedImage.value = croppedImageData.value
}

function goToProcess() { router.push('/process') }

function downloadImage() { if (croppedImageData.value) { const link = document.createElement('a'); link.download = 'cropped-image.png'; link.href = croppedImageData.value; link.click() } }

const reset = () => {
  updateDisplayedInfo()
  centerCropBox()
  if (previewCtx && previewCanvas.value) {
    previewCtx.setTransform(1, 0, 0, 1, 0, 0)
    previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height)
  }
  croppedImageData.value = null; croppedImage.value = null
}

const handleResize = () => {
  if (!imageLoaded.value) return
  updateDisplayedInfo()
  // 保持裁剪框在图像区域内
  const minX = displayedInfo.left
  const minY = displayedInfo.top
  const maxXLimit = displayedInfo.left + displayedInfo.width
  const maxYLimit = displayedInfo.top + displayedInfo.height
  const size = Number.parseInt(cropBoxStyle.value.width)
  let left = Math.max(minX, Math.min(Number.parseInt(cropBoxStyle.value.left), maxXLimit - size))
  let top = Math.max(minY, Math.min(Number.parseInt(cropBoxStyle.value.top), maxYLimit - size))
  cropBoxStyle.value = { ...cropBoxStyle.value, left: `${left}px`, top: `${top}px` }
  initPreviewCanvas()
}

watch(cropSize, () => {
  if (suppressCropSizeWatch) return
  const currentLeft = Number.parseInt(cropBoxStyle.value.left)
  const currentTop = Number.parseInt(cropBoxStyle.value.top)
  const currentCenterX = currentLeft + Number.parseInt(cropBoxStyle.value.width) / 2
  const currentCenterY = currentTop + Number.parseInt(cropBoxStyle.value.height) / 2
  const newLeft = Math.max(displayedInfo.left, Math.min(currentCenterX - cropSize.value / 2, displayedInfo.left + displayedInfo.width - cropSize.value))
  const newTop = Math.max(displayedInfo.top, Math.min(currentCenterY - cropSize.value / 2, displayedInfo.top + displayedInfo.height - cropSize.value))
  cropBoxStyle.value = { width: `${cropSize.value}px`, height: `${cropSize.value}px`, left: `${newLeft}px`, top: `${newTop}px` }
})
</script>

<style scoped>
.cut-container { min-height: 100vh; padding: 20px; }
.no-image { display: flex; justify-content: center; align-items: center; height: 80vh; }
.cut-content { max-width: 1200px; margin: 0 auto; border-radius: 15px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1); overflow: hidden; }
.main-content { display: flex; flex-wrap: wrap; padding: 20px; gap: 20px; }
.crop-section { flex: 1; min-width: 500px; }
.preview-section { flex: 0 0 350px; }
.section-title { font-size: 1.3rem; margin-bottom: 15px; color: #4b6cb7; border-bottom: 2px solid #4b6cb7; padding-bottom: 5px; }
.crop-container { position: relative; width: 100%; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 20px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.image-el { width: 100%; height: 100%; object-fit: contain; display: block; }
.crop-box { position: absolute; border: 2px solid #4b6cb7; box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.3); cursor: grab; z-index: 10; }
.crop-box:active { cursor: grabbing; }
.crop-handle { position: absolute; width: 10px; height: 10px; border: 1px solid white; }
.crop-handle-tl { top: -5px; left: -5px; cursor: nw-resize; }
.crop-handle-tr { top: -5px; right: -5px; cursor: ne-resize; }
.crop-handle-bl { bottom: -5px; left: -5px; cursor: sw-resize; }
.crop-handle-br { bottom: -5px; right: -5px; cursor: se-resize; }
.controls { padding: 15px; border-radius: 5px; }
.control-group { margin-bottom: 20px; }
.preview-container { width: 100%; aspect-ratio: 1 / 1; border: 1px solid #ddd; border-radius: 5px; margin-bottom: 20px; display: flex; justify-content: center; align-items: center; overflow: hidden; }
.preview-canvas { width: 100%; height: 100%; }
.action-buttons { display: flex; flex-direction: column; gap: 10px; }
@media (max-width: 768px) { .main-content { flex-direction: column; } .crop-section, .preview-section { min-width: 100%; } }
</style>