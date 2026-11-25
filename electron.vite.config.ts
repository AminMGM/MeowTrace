import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: { minify: true }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { minify: true }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react()],
    worker: { format: 'es' },
    build: { minify: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 1200 }
  }
})
