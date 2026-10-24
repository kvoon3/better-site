// Builds the extension and zips it for a GitHub Release
//
// Sourcemaps are left out: they are about 10x the code size and only useful when
// debugging a checkout, not when loading the extension
//
// Usage: node scripts/package.mjs
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const out = resolve(root, `better-site-${version}.zip`)

execFileSync(process.execPath, [resolve(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' })

// Zip from a staging copy so the map files can be excluded before archiving
const staging = await mkdtemp(resolve(tmpdir(), 'better-site-'))
try {
  await cp(resolve(root, 'dist'), staging, { recursive: true, filter: (src) => !src.endsWith('.map') })
  await rm(out, { force: true })
  execFileSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: staging, stdio: 'inherit' })
} finally {
  await rm(staging, { recursive: true, force: true })
}

console.log(`\nPacked ${out}`)
