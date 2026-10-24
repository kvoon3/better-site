import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUrl, parseUrlState } from '../src/core/parse.ts'

const HASH = 'a'.repeat(64)

test('github diff surfaces', () => {
  const pull = parseUrl('https://github.com/oven-sh/bun/pull/30412/changes')
  assert.equal(pull?.id, 'github')
  assert.equal(pull?.kind, 'pull')
  assert.equal(pull?.number, '30412')
  assert.deepEqual(pull?.repo, { owner: 'oven-sh', repo: 'bun' })

  const raw = parseUrl('https://github.com/oven-sh/bun/pull/30412.diff')
  assert.equal(raw?.kind, 'pull')
  assert.equal(raw?.number, '30412')

  const commit = parseUrl('https://github.com/oven-sh/bun/commit/0800fb1234567890abcdef1234567890abcdef12')
  assert.equal(commit?.kind, 'commit')
  assert.equal(commit?.sha, '0800fb1234567890abcdef1234567890abcdef12')

  const compare = parseUrl('https://github.com/torvalds/linux/compare/v6.0...v7.0')
  assert.equal(compare?.kind, 'compare')
  assert.equal(compare?.range, 'v6.0...v7.0')

  assert.equal(parseUrl('https://github.com/oven-sh/bun'), null)
  assert.equal(parseUrl('https://github.com/oven-sh/bun/issues/1'), null)
})

test('diffshub diff surfaces', () => {
  const pull = parseUrl('https://diffshub.com/oven-sh/bun/pull/30412')
  assert.equal(pull?.id, 'diffshub')
  assert.equal(pull?.kind, 'pull')

  const filesTab = parseUrl('https://diffshub.com/oven-sh/bun/pull/30412/files')
  assert.equal(filesTab?.number, '30412')

  const commit = parseUrl('https://diffshub.com/oven-sh/bun/commit/deadbeef')
  assert.equal(commit?.kind, 'commit')
  assert.equal(commit?.sha, 'deadbeef')

  const compare = parseUrl('https://diffshub.com/oven-sh/bun/compare/main...feat/x')
  assert.equal(compare?.range, 'main...feat/x')

  assert.equal(parseUrl('https://diffshub.com/oven-sh/bun/pull/1?domain=tangled.org'), null)
})

test('github hash state', () => {
  const surface = parseUrl(`https://github.com/o/r/pull/1/files#diff-${HASH}R42-R50`)
  assert.ok(surface)
  assert.deepEqual(parseUrlState(surface), {
    fileHash: HASH,
    side: 'new',
    line: 42,
    endLine: 50,
  })
})

test('diffshub hash state', () => {
  const surface = parseUrl('https://diffshub.com/o/r/pull/1#target=src/a.ts&start=D10&end=D12')
  assert.ok(surface)
  assert.deepEqual(parseUrlState(surface), {
    file: 'src/a.ts',
    side: 'old',
    line: 10,
    endLine: 12,
  })
})

test('npm surfaces', () => {
  const pkg = parseUrl('https://www.npmjs.com/package/vue')
  assert.equal(pkg?.id, 'npm')
  assert.equal(pkg?.kind, 'package')
  assert.equal(pkg?.pkg, 'vue')

  const scoped = parseUrl('https://www.npmjs.com/package/@nuxt/kit/v/4.0.0')
  assert.equal(scoped?.pkg, '@nuxt/kit')
  assert.equal(scoped?.version, '4.0.0')
  assert.equal(scoped?.kind, 'version')

  const user = parseUrl('https://www.npmjs.com/~sindresorhus')
  assert.equal(user?.kind, 'user')
  assert.equal(user?.user, 'sindresorhus')

  const search = parseUrl('https://www.npmjs.com/search?q=vue')
  assert.equal(search?.kind, 'search')
  assert.equal(search?.query, 'vue')

  const org = parseUrl('https://www.npmjs.com/org/nuxt')
  assert.equal(org?.kind, 'org')
  assert.equal(org?.org, 'nuxt')
})

test('npmx surfaces', () => {
  const pkg = parseUrl('https://npmx.dev/package/vue')
  assert.equal(pkg?.id, 'npmx')
  assert.equal(pkg?.pkg, 'vue')

  const version = parseUrl('https://npmx.dev/package/@nuxt/kit/v/4.0.0')
  assert.equal(version?.pkg, '@nuxt/kit')
  assert.equal(version?.version, '4.0.0')

  const diff = parseUrl('https://npmx.dev/diff/@nuxt/kit/v/4.0.0...4.2.0')
  assert.equal(diff?.kind, 'diff')
  assert.equal(diff?.pkg, '@nuxt/kit')
  assert.equal(diff?.from, '4.0.0')
  assert.equal(diff?.to, '4.2.0')

  const code = parseUrl('https://npmx.dev/package-code/vue/v/3.5.27/dist/vue.d.ts#L10-L20')
  assert.equal(code?.kind, 'code')
  assert.equal(code?.file, 'dist/vue.d.ts')
  assert.deepEqual(parseUrlState(code!), { file: 'dist/vue.d.ts', side: 'new', line: 10, endLine: 20 })

  const diffWithFile = parseUrl('https://npmx.dev/diff/vue/v/3.5.26...3.5.27?file=dist/vue.d.ts')
  assert.deepEqual(parseUrlState(diffWithFile!), { file: 'dist/vue.d.ts' })

  assert.equal(parseUrl('https://npmx.dev/about'), null)
  assert.equal(parseUrl('https://npmx.dev/tools/deps-stats'), null)
})

test('npmx short forms', () => {
  const pkg = parseUrl('https://npmx.dev/nuxt')
  assert.equal(pkg?.kind, 'package')
  assert.equal(pkg?.pkg, 'nuxt')

  const version = parseUrl('https://npmx.dev/vue@3.5.27')
  assert.equal(version?.kind, 'version')
  assert.equal(version?.pkg, 'vue')
  assert.equal(version?.version, '3.5.27')

  const scoped = parseUrl('https://npmx.dev/@nuxt/kit')
  assert.equal(scoped?.pkg, '@nuxt/kit')

  const org = parseUrl('https://npmx.dev/@nuxt')
  assert.equal(org?.kind, 'org')
  assert.equal(org?.org, 'nuxt')
})

test('xnpmjs alias parses as npmx', () => {
  const pkg = parseUrl('https://xnpmjs.com/package/vue')
  assert.equal(pkg?.id, 'npmx')
  assert.equal(pkg?.pkg, 'vue')
})
