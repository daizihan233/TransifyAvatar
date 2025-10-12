<template>
  <div class="cut-container">
    <div v-if="!imageSrc" class="no-image">
      <n-result status="404" title="未找到图片" description="请先上传图片">
        <template #footer>
          <n-button @click="$router.push('/')">返回上传页面</n-button>
        </template>
      </n-result>
    </div>

    <div v-else class="cut-content">
      <div class="header">
        <h1>图片裁剪工具</h1>
        <p>拖动裁剪框选择正方形区域，然后点击裁剪按钮</p>
      </div>

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
              <div class="crop-handle crop-handle-tl"></div>
              <div class="crop-handle crop-handle-tr"></div>
              <div class="crop-handle crop-handle-bl"></div>
              <div class="crop-handle crop-handle-br"></div>
            </div>
          </div>

          <div class="controls">
            <div class="control-group">
              <label>裁剪框大小: {{ cropSize }}px</label>
              <n-slider
                  v-model:value="cropSize"
                  :min="50"
                  :max="maxCropSize"
                  :step="10"
              />
            </div>

            <div class="control-group">
              <label>图片缩放: {{ Math.round(scale * 100) }}%</label>
              <n-slider
                  v-model:value="scale"
                  :min="0.1"
                  :max="3"
                  :step="0.1"
              />
            </div>
          </div>
        </div>

        <div class="preview-section">
          <div class="section-title">预览</div>
          <div class="preview-container">
            <canvas ref="previewCanvas" class="preview-canvas"></canvas>
          </div>

          <div class="action-buttons">
            <n-button
                type="primary"
                @click="cropImage"
                :disabled="!imageLoaded"
            >
              裁剪图片
            </n-button>
            <n-button
                type="success"
                @click="downloadImage"
                :disabled="!croppedImageData"
            >
              下载图片
            </n-button>
            <n-button @click="reset">重置</n-button>
            <n-button @click="$router.push('/')">返回上传</n-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { NButton, NResult, NSlider } from 'naive-ui';
import { useUploadedImage } from '~~/composables/useUploadedImage.js';

const router = useRouter();
const { uploadedImage, croppedImage } = useUploadedImage();

// Refs
const imageCanvas = ref(null);
const previewCanvas = ref(null);
const cropBox = ref(null);
const cropContainer = ref(null);

// 响应式数据
const imageSrc = ref(uploadedImage.value || '');
const imageLoaded = ref(false);
const croppedImageData = ref(null);
const scale = ref(1);
const cropSize = ref(200);
const maxCropSize = ref(300);

// 裁剪框位置和状态
const cropBoxStyle = ref({
  width: '200px',
  height: '200px',
  left: '100px',
  top: '100px'
});

// 图片和Canvas上下文
let image = null;
let ctx = null;
let previewCtx = null;

// 拖动状态
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let cropBoxStartX = 0;
let cropBoxStartY = 0;

// Canvas绘制信息
let canvasInfo = {
  x: 0, // Canvas在容器中的x偏移
  y: 0, // Canvas在容器中的y偏移
  width: 0, // Canvas宽度
  height: 0, // Canvas高度
  imageWidth: 0, // 图片在Canvas中的绘制宽度
  imageHeight: 0, // 图片在Canvas中的绘制高度
  imageX: 0, // 图片在Canvas中的x偏移
  imageY: 0 // 图片在Canvas中的y偏移
};

// 监听图片数据变化
watch(uploadedImage, (newVal) => {
  if (newVal) {
    imageSrc.value = newVal;
    nextTick(() => {
      loadImage();
    });
  }
});

// 组件挂载时初始化
onMounted(() => {
  if (imageSrc.value) {
    loadImage();
  }

  // 添加事件监听器
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', stopDrag);
  window.addEventListener('resize', handleResize);
});

// 组件卸载时清理
onUnmounted(() => {
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
  window.removeEventListener('resize', handleResize);
});

// 加载图片
const loadImage = () => {
  if (!imageSrc.value) return;

  image = new Image();
  image.onload = () => {
    imageLoaded.value = true;
    initCanvas();
    drawImage();
  };
  image.onerror = () => {
    console.error('图片加载失败');
  };
  image.src = imageSrc.value;
};

// 初始化Canvas
const initCanvas = () => {
  if (!imageCanvas.value || !previewCanvas.value) return;

  // 设置图像Canvas尺寸
  const container = cropContainer.value;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  // 根据图片比例计算Canvas尺寸
  const imageRatio = image.width / image.height;
  let canvasWidth, canvasHeight;

  if (imageRatio > 1) {
    // 宽图
    canvasWidth = Math.min(containerWidth, image.width);
    canvasHeight = canvasWidth / imageRatio;
  } else {
    // 高图或方图
    canvasHeight = Math.min(containerHeight, image.height);
    canvasWidth = canvasHeight * imageRatio;
  }

  imageCanvas.value.width = canvasWidth;
  imageCanvas.value.height = canvasHeight;

  // 设置预览Canvas尺寸
  previewCanvas.value.width = 300;
  previewCanvas.value.height = 300;

  // 获取上下文
  ctx = imageCanvas.value.getContext('2d');
  previewCtx = previewCanvas.value.getContext('2d');

  // 设置最大裁剪尺寸
  maxCropSize.value = Math.min(canvasWidth, canvasHeight, 500);
  cropSize.value = Math.min(200, maxCropSize.value);

  // 更新Canvas信息
  updateCanvasInfo();

  // 初始裁剪框位置（居中）
  const initialLeft = (canvasWidth - cropSize.value) / 2;
  const initialTop = (canvasHeight - cropSize.value) / 2;

  cropBoxStyle.value = {
    width: `${cropSize.value}px`,
    height: `${cropSize.value}px`,
    left: `${initialLeft}px`,
    top: `${initialTop}px`
  };
};

// 更新Canvas信息
const updateCanvasInfo = () => {
  if (!imageCanvas.value) return;

  const canvas = imageCanvas.value;
  const rect = canvas.getBoundingClientRect();
  const containerRect = cropContainer.value.getBoundingClientRect();

  canvasInfo.x = rect.left - containerRect.left;
  canvasInfo.y = rect.top - containerRect.top;
  canvasInfo.width = canvas.width;
  canvasInfo.height = canvas.height;

  // 计算图片在Canvas中的绘制尺寸和位置
  const imageRatio = image.width / image.height;
  let drawWidth, drawHeight;

  if (imageRatio > 1) {
    drawWidth = canvas.width;
    drawHeight = drawWidth / imageRatio;
  } else {
    drawHeight = canvas.height;
    drawHeight = canvas.height;
    drawWidth = drawHeight * imageRatio;
  }

  canvasInfo.imageWidth = drawWidth;
  canvasInfo.imageHeight = drawHeight;
  canvasInfo.imageX = (canvas.width - drawWidth) / 2;
  canvasInfo.imageY = (canvas.height - drawHeight) / 2;
};

// 绘制图片到Canvas
const drawImage = () => {
  if (!ctx || !image) return;

  ctx.clearRect(0, 0, imageCanvas.value.width, imageCanvas.value.height);

  // 计算缩放后的图片尺寸
  const scaledWidth = canvasInfo.imageWidth * scale.value;
  const scaledHeight = canvasInfo.imageHeight * scale.value;

  // 计算居中位置
  const x = (imageCanvas.value.width - scaledWidth) / 2;
  const y = (imageCanvas.value.height - scaledHeight) / 2;

  ctx.save();
  ctx.drawImage(image, x, y, scaledWidth, scaledHeight);
  ctx.restore();
};

// 开始拖动
const startDrag = (e) => {
  e.preventDefault();
  isDragging = true;

  // 记录起始位置
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  // 记录裁剪框当前位置
  cropBoxStartX = parseInt(cropBoxStyle.value.left);
  cropBoxStartY = parseInt(cropBoxStyle.value.top);

  // 更改光标样式
  if (cropBox.value) {
    cropBox.value.style.cursor = 'grabbing';
  }
};

// 处理拖动
const handleDrag = (e) => {
  if (!isDragging) return;

  // 计算移动距离
  const deltaX = e.clientX - dragStartX;
  const deltaY = e.clientY - dragStartY;

  // 计算新位置
  let newX = cropBoxStartX + deltaX;
  let newY = cropBoxStartY + deltaY;

  // 限制不超出Canvas边界
  newX = Math.max(0, Math.min(newX, canvasInfo.width - cropSize.value));
  newY = Math.max(0, Math.min(newY, canvasInfo.height - cropSize.value));

  // 更新裁剪框位置
  cropBoxStyle.value = {
    ...cropBoxStyle.value,
    left: `${newX}px`,
    top: `${newY}px`
  };
};

// 停止拖动
const stopDrag = () => {
  isDragging = false;
  if (cropBox.value) {
    cropBox.value.style.cursor = 'grab';
  }
};

// 裁剪图片
const cropImage = () => {
  if (!image || !previewCtx) return;

  // 获取裁剪框在Canvas中的位置
  const cropX = parseInt(cropBoxStyle.value.left);
  const cropY = parseInt(cropBoxStyle.value.top);

  // 计算裁剪区域在原始图片中的位置和尺寸
  // 首先计算Canvas坐标到原始图片坐标的转换比例
  const scaleX = image.width / (canvasInfo.imageWidth * scale.value);
  const scaleY = image.height / (canvasInfo.imageHeight * scale.value);

  // 计算裁剪区域相对于图片绘制区域的偏移
  const relativeX = cropX - (canvasInfo.width - canvasInfo.imageWidth * scale.value) / 2;
  const relativeY = cropY - (canvasInfo.height - canvasInfo.imageHeight * scale.value) / 2;

  // 转换为原始图片坐标
  const srcX = Math.max(0, relativeX * scaleX);
  const srcY = Math.max(0, relativeY * scaleY);
  const srcSize = Math.min(cropSize.value * scaleX, image.width - srcX, image.height - srcY);

  // 创建临时Canvas进行裁剪
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = srcSize;
  tempCanvas.height = srcSize;
  const tempCtx = tempCanvas.getContext('2d');

  // 从原始图片裁剪
  tempCtx.drawImage(
      image,
      srcX, srcY, srcSize, srcSize,
      0, 0, srcSize, srcSize
  );

  // 绘制到预览Canvas
  previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height);
  previewCtx.drawImage(
      tempCanvas,
      0, 0, srcSize, srcSize,
      0, 0, previewCanvas.value.width, previewCanvas.value.height
  );

  // 保存裁剪后的图片数据
  croppedImageData.value = tempCanvas.toDataURL('image/png');
  croppedImage.value = croppedImageData.value;
};

// 下载图片
const downloadImage = () => {
  if (!croppedImageData.value) return;

  const link = document.createElement('a');
  link.download = 'cropped-image.png';
  link.href = croppedImageData.value;
  link.click();
};

// 重置
const reset = () => {
  scale.value = 1;

  // 重置裁剪框位置（居中）
  const initialLeft = (canvasInfo.width - cropSize.value) / 2;
  const initialTop = (canvasInfo.height - cropSize.value) / 2;

  cropBoxStyle.value = {
    width: `${cropSize.value}px`,
    height: `${cropSize.value}px`,
    left: `${initialLeft}px`,
    top: `${initialTop}px`
  };

  if (previewCtx) {
    previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height);
  }

  croppedImageData.value = null;
  croppedImage.value = null;

  drawImage();
};

// 处理窗口大小变化
const handleResize = () => {
  if (imageLoaded.value) {
    initCanvas();
    drawImage();
  }
};

// 监听缩放和裁剪尺寸变化
watch(scale, () => {
  if (imageLoaded.value) {
    drawImage();
  }
});

watch(cropSize, () => {
  // 保持裁剪框中心位置不变
  const currentLeft = parseInt(cropBoxStyle.value.left);
  const currentTop = parseInt(cropBoxStyle.value.top);
  const currentCenterX = currentLeft + parseInt(cropBoxStyle.value.width) / 2;
  const currentCenterY = currentTop + parseInt(cropBoxStyle.value.height) / 2;

  const newLeft = Math.max(0, Math.min(currentCenterX - cropSize.value / 2, canvasInfo.width - cropSize.value));
  const newTop = Math.max(0, Math.min(currentCenterY - cropSize.value / 2, canvasInfo.height - cropSize.value));

  cropBoxStyle.value = {
    width: `${cropSize.value}px`,
    height: `${cropSize.value}px`,
    left: `${newLeft}px`,
    top: `${newTop}px`
  };
});
</script>

<style scoped>
.cut-container {
  min-height: 100vh;
  padding: 20px;
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
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
  background: white;
  border-radius: 15px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.header {
  background: linear-gradient(90deg, #4b6cb7 0%, #182848 100%);
  color: white;
  padding: 25px;
  text-align: center;
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
  background: #f8f9fa;
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
  padding: 15px;
  background: #f8f9fa;
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
  background: #f8f9fa;
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