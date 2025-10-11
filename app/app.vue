<template>
  <n-config-provider :theme="theme" :date-locale="dateZhCN" :locale="zhCN" class="full">
    <n-global-style />
    <n-message-provider class="full">
      <n-dialog-provider class="full">
        <n-space vertical class="center stat">
          <n-steps :current="current" :status="currentStatus">
            <n-step
                title="上传图片"
            />
            <n-step
                title="模型处理"
            />
            <n-step
                title="完成！！"
            />
          </n-steps>
          <n-space>
            <n-button-group>
              <n-button @click="prev">
                <template #icon>
                  <n-icon>
                    <MdArrowRoundBack />
                  </n-icon>
                </template>
              </n-button>
              <n-button @click="next">
                <template #icon>
                  <n-icon>
                    <MdArrowRoundForward />
                  </n-icon>
                </template>
              </n-button>
            </n-button-group>
            <n-radio-group v-model:value="currentStatus" size="medium" name="basic">
              <n-radio-button value="error">
                Error
              </n-radio-button>
              <n-radio-button value="process">
                Process
              </n-radio-button>
              <n-radio-button value="wait">
                Wait
              </n-radio-button>
              <n-radio-button value="finish">
                Finish
              </n-radio-button>
            </n-radio-group>
          </n-space>
        </n-space>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>


<script setup>
import { computed, ref } from "vue";
import {
  zhCN, dateZhCN , NConfigProvider, darkTheme, NDialogProvider, NMessageProvider, useOsTheme, NGlobalStyle
} from "naive-ui";
import { MdArrowRoundBack, MdArrowRoundForward } from "@vicons/ionicons4";

const osThemeRef = useOsTheme();
let theme = computed(() => osThemeRef.value === "dark" ? darkTheme : null);

const currentRef = ref(1);
const currentStatus = ref("process");
const current = currentRef;

function next() {
  if (currentRef.value === null)
    currentRef.value = 1;
  else if (currentRef.value >= 3)
    currentRef.value = null;
  else currentRef.value++;
}

function prev() {
  if (currentRef.value === 0)
    currentRef.value = null;
  else if (currentRef.value === null)
    currentRef.value = 3;
  else currentRef.value--;
}
</script>