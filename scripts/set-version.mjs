// Copies the package.json version into the manifest and upm.lock
//
// upm.lock holds unrelated "version" fields, including a `yocto-queue: "0.1.0"`
// spec that matches this project's own version, so a global replace would
// corrupt it. Only the top-level field is rewritten here
//
// Usage: node scripts/set-version.mjs [--check]
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const check = process.argv.includes('--check')

const targets = [
  { file: 'src/extension/manifest.json', scope: null, read: (json) => json.version },
  { file: 'upm.lock', scope: '"root": {', read: (json) => json.root?.version },
]

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'))
}

function withVersion(text, version, scope) {
  const from = scope ? text.indexOf(scope) : 0
  if (from === -1) throw new Error(`could not find ${scope}`)

  const pattern = /("version"\s*:\s*")([^"]*)(")/
  const match = pattern.exec(text.slice(from))
  if (!match) throw new Error('could not find a version field')

  const at = from + match.index
  return text.slice(0, at) + `${match[1]}${version}${match[3]}` + text.slice(at + match[0].length)
}

const version = (await readJson('package.json')).version
if (typeof version !== 'string' || !version) throw new Error('package.json has no version')

const stale = []

for (const { file, scope, read } of targets) {
  const before = await readFile(resolve(root, file), 'utf8')
  const after = withVersion(before, version, scope)

  if (after === before) continue
  stale.push(file)

  if (!check) {
    if (read(JSON.parse(after)) !== version) throw new Error(`${file} did not parse back with the new version`)
    await writeFile(resolve(root, file), after)
    console.log(`set ${file} to ${version}`)
  }
}

if (check) {
  if (stale.length > 0) {
    console.error(`out of sync with package.json@${version}: ${stale.join(', ')}`)
    console.error('run `node scripts/set-version.mjs` to fix')
    process.exit(1)
  }
  console.log(`all files are at ${version}`)
}
