import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: resolve('electron/main.ts') } }
    },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('electron/preload.ts') },
        // sandboxed preloads must be CommonJS
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: '.',
    build: {
      rollupOptions: { input: { index: resolve('index.html') } }
    },
    resolve: {
      alias: { '@': resolve('src'), '@shared': resolve('src/shared') }
    },
    plugins: [vue(), tailwindcss()]
  }
})
