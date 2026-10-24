import { fileURLToPath } from 'node:url'
import solid from '@solidjs/vite-plugin'
import stylex from '@stylexjs/unplugin/vite'
import { defineConfig } from 'vite'

const settingsRoot = fileURLToPath(new URL('./src/settings', import.meta.url))
const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const outDir = fileURLToPath(new URL('./dist', import.meta.url))

export default defineConfig({
  root: settingsRoot,
  base: './',
  publicDir: false,
  plugins: [
    stylex({
      importSources: ['@stylexjs/stylex'],
      unstable_moduleResolution: {
        type: 'commonJS',
        rootDir: projectRoot,
      },
    }),
    solid(),
  ],
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome114',
    cssCodeSplit: false,
    sourcemap: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/settings/options.html', import.meta.url)),
    },
  },
  server: {
    port: 5178,
    strictPort: true,
  },
})
