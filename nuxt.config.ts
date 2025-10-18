import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-10-18',
    modules: ['nuxtjs-naive-ui'],

    // 🔧 完全禁用 SSR，确保所有代码只在客户端运行
    ssr: false,

    build: {
        transpile: ['naive-ui', 'vueuc']
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
            // 完全排除所有 transformers 和 onnx 相关包
            exclude: [
                '@huggingface/transformers',
                'onnxruntime-node',
                'onnxruntime-common',
                'onnxruntime-web'
            ]
        },
        build: {
            rollupOptions: {
                external: (id) => {
                    // 排除所有 onnx 和 wasm 相关文件
                    if (id.includes('onnxruntime')) return true
                    if (id.includes('.wasm')) return true
                    if (id.includes('sharp')) return true
                    return false
                }
            }
        }
    },

    css: [
        new URL('./assets/main.css', import.meta.url).pathname,
    ]
})