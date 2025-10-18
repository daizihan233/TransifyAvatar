import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    compatibilityDate: '2025-10-18',
    modules: ['nuxtjs-naive-ui'],

    ssr: true,

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
            exclude: ['@huggingface/transformers', 'onnxruntime-node'],
            include: []
        },
        resolve: {
            alias: {
                // 🔧 修复 onnxruntime-common 裸说明符问题
                'onnxruntime-common': 'onnxruntime-common/dist/ort-common.min.js',
                'onnxruntime-web': 'onnxruntime-web/dist/ort.min.js'
            }
        },
        build: {
            rollupOptions: {
                external: (id) => {
                    // 排除 WASM 和 Node.js 特定模块
                    return id.includes('.wasm') ||
                        id.includes('onnxruntime-node') ||
                        id.includes('sharp')
                }
            }
        }
    },

    css: [
        new URL('./assets/main.css', import.meta.url).pathname,
    ]
})