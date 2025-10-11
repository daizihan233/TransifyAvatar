<template>
  <n-upload
      multiple
      directory-dnd
      action="https://www.mocky.io/v2/5e4bafc63100007100d8b70f"
      :max="1"
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
import {NIcon, NUpload, NUploadDragger, NText, NP} from "naive-ui";
</script>