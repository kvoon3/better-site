// Syncs the version files, then refuses to continue if anything else is dirty
//
// Runs from bump.config.ts between bumpp writing package.json and bumpp
// committing. bumpp cannot stage the extra files itself: an unrecognised name in
// `files` gets a global replace, and `all: true` skips its clean-tree check, so a
// stray file would land in the release commit
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

const allowed = new Set(['package.json', 'src/extension/manifest.json', 'upm.lock'])

execFileSync(process.execPath, [resolve(root, 'scripts/set-version.mjs')], { cwd: root, stdio: 'inherit' })

const unexpected = git('status', '--porcelain')
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3).trim())
  .filter((path) => !allowed.has(path))

if (unexpected.length > 0) {
  console.error('\nRefusing to release: the working tree has changes outside the version files,')
  console.error('and `all: true` would commit them. Commit or stash these first:\n')
  for (const path of unexpected) console.error(`  ${path}`)
  process.exit(1)
}
