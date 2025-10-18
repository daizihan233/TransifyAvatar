import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-10-18',
    modules: ['nuxtjs-naive-ui'],

    ssr: false,

    build: {
        transpile: ['naive-ui','vueuc']
    },

    vite: {
        plugins: [
            tsconfigPaths(),
            AutoImport({
                imports: [
                    {
                        'naive-ui': [
                            'useDialog',
                            'useMessage',
                            'useNotification',
                            'useLoadingBar'
                        ]
                    }
                ]
            }),
            Components({
                resolvers: [NaiveUiResolver()]
            })
        ],
        optimizeDeps: {
            exclude: ['@huggingface/transformers'],
            include: []
        },
        build: {
            rollupOptions: {
                external: (id) => {
                    // 排除 WASM 和 ONNX 相关文件
                    return id.includes('.wasm') || id.includes('onnxruntime')
                }
            }
        }
    },

    css: [
        new URL('./assets/main.css', import.meta.url).pathname,
    ]
})