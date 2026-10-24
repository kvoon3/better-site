import assert from 'node:assert/strict'
import test from 'node:test'
import { exactVersion, parseBunLock, parsePackageJsonDeps, parsePackageLock, parsePnpmLock, parseYarnLock } from '../src/core/lockfiles.ts'

test('package-lock v2/v3', () => {
  const map = parsePackageLock(
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'root' },
        'node_modules/vue': { version: '3.5.27' },
        'node_modules/@scope/pkg': { version: '1.2.3' },
        'node_modules/a/node_modules/nested': { version: '4.5.6' },
        'node_modules/link': { link: true },
      },
    }),
  )
  assert.deepEqual(
    [...map!],
    [
      ['vue', '3.5.27'],
      ['@scope/pkg', '1.2.3'],
      ['nested', '4.5.6'],
    ],
  )
})

test('package-lock v1 dependency tree', () => {
  const map = parsePackageLock(
    JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        vue: { version: '3.4.0', dependencies: { nested: { version: '1.0.0' } } },
      },
    }),
  )
  assert.equal(map?.get('vue'), '3.4.0')
  assert.equal(map?.get('nested'), '1.0.0')
})

test('pnpm v9 keys and peer suffixes', () => {
  const map = parsePnpmLock(`
lockfileVersion: '9.0'

importers:
  .:
    dependencies:
      vue:
        specifier: ^3.5.0
        version: 3.5.27

packages:
  vue@3.5.27:
    resolution: {integrity: sha512-a}
  '@scope/name@1.2.3':
    resolution: {integrity: sha512-b}
  vue@3.5.27(react@18.2.0):
    resolution: {integrity: sha512-c}

snapshots:
  vue@3.5.27:
    dependencies:
      '@vue/shared': 3.5.27
`)
  assert.equal(map?.get('vue'), '3.5.27')
  assert.equal(map?.get('@scope/name'), '1.2.3')
})

test('pnpm v6 slash keys', () => {
  const map = parsePnpmLock(`
lockfileVersion: '6.0'

packages:

  /vue@3.4.0:
    resolution: {integrity: sha512-a}
    dev: false

  /@scope/name/1.2.3:
    resolution: {integrity: sha512-b}

  /lodash/4.17.21(react@18.2.0):
    resolution: {integrity: sha512-c}
`)
  assert.equal(map?.get('vue'), '3.4.0')
  assert.equal(map?.get('@scope/name'), '1.2.3')
  assert.equal(map?.get('lodash'), '4.17.21')
})

test('yarn v1 and berry', () => {
  const v1 = parseYarnLock(`
# yarn lockfile v1


vue@^3.0.0, vue@^3.4.0:
  version "3.5.27"
  resolved "https://registry.yarnpkg.com/vue/-/vue-3.5.27.tgz"

"@scope/name@^1.0.0":
  version "1.2.3"
`)
  assert.equal(v1?.get('vue'), '3.5.27')
  assert.equal(v1?.get('@scope/name'), '1.2.3')

  const berry = parseYarnLock(`
__metadata:
  version: 8

"vue@npm:^3.0.0":
  version: 3.5.27
  resolution: "vue@npm:3.5.27"

"@scope/name@npm:^1.0.0":
  version: 1.2.3
  resolution: "@scope/name@npm:1.2.3"
`)
  assert.equal(berry?.get('vue'), '3.5.27')
  assert.equal(berry?.get('@scope/name'), '1.2.3')
})

test('bun.lock text format', () => {
  const map = parseBunLock(`{
  // bun lockfile
  "lockfileVersion": 1,
  "packages": {
    "vue": ["vue@3.5.27", "", {}, "sha512-a"],
    "@scope/name": ["@scope/name@1.2.3", "", {}, "sha512-b"],
  },
}`)
  assert.equal(map?.get('vue'), '3.5.27')
  assert.equal(map?.get('@scope/name'), '1.2.3')
})

test('package.json dependency sections and exact versions', () => {
  const map = parsePackageJsonDeps(
    JSON.stringify({
      dependencies: { vue: '^3.5.0' },
      devDependencies: { vitest: '1.2.3' },
      peerDependencies: { react: '>=18' },
    }),
  )
  assert.equal(map?.get('vue')?.range, '^3.5.0')
  assert.equal(map?.get('vitest')?.section, 'devDependencies')
  assert.equal(exactVersion('1.2.3'), '1.2.3')
  assert.equal(exactVersion('=1.2.3'), '1.2.3')
  assert.equal(exactVersion('^1.2.3'), null)
})
