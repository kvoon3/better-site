import { build } from 'esbuild'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

const common = {
  bundle: true,
  format: 'iife',
  target: ['chrome114'],
  sourcemap: true,
  logLevel: 'info',
  legalComments: 'none',
}

await build({
  ...common,
  entryPoints: [resolve(root, 'src/extension/background.ts')],
  outfile: resolve(dist, 'background.js'),
})

await build({
  ...common,
  entryPoints: [resolve(root, 'src/extension/content.ts')],
  outfile: resolve(dist, 'content.js'),
})

await build({
  ...common,
  entryPoints: [resolve(root, 'src/demo/main.ts')],
  outfile: resolve(dist, 'demo.js'),
})

await copyFile(resolve(root, 'src/extension/manifest.json'), resolve(dist, 'manifest.json'))
await copyFile(resolve(root, 'demo/index.html'), resolve(dist, 'demo.html'))

await viteBuild({
  configFile: resolve(root, 'vite.config.ts'),
  logLevel: 'info',
})

console.log('\nBuilt extension + demo + settings into dist/')
console.log('Load dist/ as an unpacked extension at chrome://extensions')
console.log('Open dist/demo.html to try the URL algebra without installing.')
console.log('Open the extension options page for settings.')
