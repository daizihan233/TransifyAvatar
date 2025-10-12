<template>
  <n-upload
      multiple
      directory-dnd
      :on-before-upload="handleBeforeUpload"
      :max="1"
      accept="image/*"
  >
    <n-upload-dragger>
      <div style="margin-bottom: 12px">
        <n-icon size="48" :depth="3">
          <Archive />
        </n-icon>
      </div>
      <n-text style="font-size: 16px">
        点击或者拖动文件到该区域来上传
      </n-text>
      <n-p depth="3" style="margin: 8px 0 0 0">
        图片不会上传服务器，所有计算与处理在本地进行
      </n-p>
    </n-upload-dragger>
  </n-upload>
</template>

<script setup>
import { Archive } from "@vicons/ionicons5";
import { NIcon, NUpload, NUploadDragger, NText, NP } from "naive-ui";
import { useRouter } from "vue-router";
import { useUploadedImage } from "~~/composables/useUploadedImage.js";

const router = useRouter();
const { uploadedImage, croppedImage, mattedImage } = useUploadedImage();

function handleBeforeUpload({ file }) {
  if (!file) return false;
  const reader = new FileReader();
  reader.onload = () => {
    uploadedImage.value = String(reader.result || "");
    // reset downstream state
    croppedImage.value = null;
    mattedImage.value = null;
    router.push("/process");
  };
  reader.readAsDataURL(file.file || file);
  // prevent default upload
  return false;
}
</script>