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
          <div class="crop-container">
            <canvas ref="imageCanvas" class="image-canvas"></canvas>
            <div
                ref="cropBox"
                class="crop-box"
                :style="cropBoxStyle"
                @mousedown="startDrag"
            ></div>
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

// 响应式数据
const imageSrc = ref(uploadedImage.value || '');
const imageLoaded = ref(false);
const croppedImageData = ref(null);
const scale = ref(1);
const cropSize = ref(200);
const maxCropSize = ref(300);
const cropBoxStyle = ref({
  width: '200px',
  height: '200px',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)'
});

// 图片和Canvas上下文
let image = null;
let ctx = null;
let previewCtx = null;
let isDragging = false;
let startX = 0;
let startY = 0;
let offsetX = 0;
let offsetY = 0;

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
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', stopDrag);
  window.addEventListener('resize', handleResize);
});

// 组件卸载时清理
onUnmounted(() => {
  document.removeEventListener('mousemove', drag);
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
  const container = imageCanvas.value.parentElement;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight - 100; // 留出控制区域空间

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
  maxCropSize.value = Math.min(image.width, image.height, 500);
  cropSize.value = Math.min(200, maxCropSize.value);

  // 初始偏移量
  offsetX = 0;
  offsetY = 0;

  // 更新裁剪框样式
  updateCropBoxStyle();
};

// 绘制图片到Canvas
const drawImage = () => {
  if (!ctx || !image) return;

  ctx.clearRect(0, 0, imageCanvas.value.width, imageCanvas.value.height);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale.value, scale.value);
  ctx.drawImage(image, 0, 0, imageCanvas.value.width, imageCanvas.value.height);
  ctx.restore();
};

// 更新裁剪框样式
const updateCropBoxStyle = () => {
  if (!cropBox.value) return;

  cropBoxStyle.value = {
    width: `${cropSize.value}px`,
    height: `${cropSize.value}px`,
    left: cropBoxStyle.value.left,
    top: cropBoxStyle.value.top
  };
};

// 开始拖动
const startDrag = (e) => {
  isDragging = true;
  startX = e.clientX - parseInt(cropBoxStyle.value.left);
  startY = e.clientY - parseInt(cropBoxStyle.value.top);
  cropBox.value.style.cursor = 'grabbing';
};

// 拖动中
const drag = (e) => {
  if (!isDragging || !cropBox.value) return;

  const container = imageCanvas.value;
  const rect = container.getBoundingClientRect();

  let x = e.clientX - startX - rect.left;
  let y = e.clientY - startY - rect.top;

  // 限制裁剪框不超出Canvas边界
  x = Math.max(0, Math.min(x, rect.width - cropSize.value));
  y = Math.max(0, Math.min(y, rect.height - cropSize.value));

  cropBoxStyle.value.left = `${x}px`;
  cropBoxStyle.value.top = `${y}px`;
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

  // 计算裁剪区域在原始图片上的位置和尺寸
  const canvasRect = imageCanvas.value.getBoundingClientRect();
  const cropBoxRect = cropBox.value.getBoundingClientRect();

  // 计算相对于Canvas的裁剪位置
  const cropX = (cropBoxRect.left - canvasRect.left) / scale.value;
  const cropY = (cropBoxRect.top - canvasRect.top) / scale.value;
  const size = cropSize.value / scale.value;

  // 确保裁剪区域不超出图片边界
  const x = Math.max(0, Math.min(cropX, image.width - size));
  const y = Math.max(0, Math.min(cropY, image.height - size));
  const cropWidth = Math.min(size, image.width - x);
  const cropHeight = Math.min(size, image.height - y);

  // 创建临时Canvas进行裁剪
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = cropWidth;
  tempCanvas.height = cropHeight;
  const tempCtx = tempCanvas.getContext('2d');

  // 从原始图片裁剪
  tempCtx.drawImage(
      image,
      x, y, cropWidth, cropHeight,
      0, 0, cropWidth, cropHeight
  );

  // 绘制到预览Canvas
  previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height);
  previewCtx.drawImage(
      tempCanvas,
      0, 0, cropWidth, cropHeight,
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
  offsetX = 0;
  offsetY = 0;
  cropSize.value = Math.min(200, maxCropSize.value);

  if (cropBox.value) {
    cropBoxStyle.value.left = '50%';
    cropBoxStyle.value.top = '50%';
  }

  if (previewCtx) {
    previewCtx.clearRect(0, 0, previewCanvas.value.width, previewCanvas.value.height);
  }

  croppedImageData.value = null;
  croppedImage.value = null;

  drawImage();
  updateCropBoxStyle();
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
  updateCropBoxStyle();
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
  border: 2px dashed #fff;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  cursor: grab;
  z-index: 10;
}

.crop-box:active {
  cursor: grabbing;
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