<template>
  <n-config-provider :theme="themeRef" :date-locale="dateZhCN" :locale="zhCN" class="full">
    <n-global-style />
    <n-message-provider class="full">
      <n-dialog-provider class="full">
        <n-flex vertical class="center stat">
          <n-space vertical>
            <n-steps :current="current" :status="currentStatus">
              <n-step
                  title="上传图片"
              />
              <n-step
                  title="图片裁剪"
              />
              <n-step
                  title="模型处理"
              />
              <n-step
                  title="完成！！"
              />
            </n-steps>
          </n-space>
          <NuxtPage />
        </n-flex>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>


<script setup>
import { ref, onMounted, watch } from "vue";
import {
  zhCN, dateZhCN , NConfigProvider, darkTheme, NDialogProvider, NMessageProvider, useOsTheme, NGlobalStyle
} from "naive-ui";

// Ensure SSR and initial client render use the same theme (null/light), then switch on mounted based on OS.
const themeRef = ref(null);
if (process.client) {
  const osThemeRef = useOsTheme();
  const applyTheme = (val) => {
    themeRef.value = val === "dark" ? darkTheme : null;
  };
  onMounted(() => {
    applyTheme(osThemeRef.value);
  });
  watch(osThemeRef, (val) => applyTheme(val));
}

const currentRef = ref(1);
const currentStatus = ref("process");
const current = currentRef;

function next() {
  if (currentRef.value === null)
    currentRef.value = 1;
  else if (currentRef.value >= 4)
    currentRef.value = null;
  else currentRef.value++;
}

function prev() {
  if (currentRef.value === 0)
    currentRef.value = null;
  else if (currentRef.value === null)
    currentRef.value = 4;
  else currentRef.value--;
}
</script>