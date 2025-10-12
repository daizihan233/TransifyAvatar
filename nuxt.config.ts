import AutoImport from 'unplugin-auto-import/vite'
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers'
import Components from 'unplugin-vue-components/vite'
import tsconfigPaths from 'vite-tsconfig-paths'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    modules: ['nuxtjs-naive-ui'],
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
        ]
    },
    css: [
        new URL('./assets/main.css', import.meta.url).pathname,
    ]
})