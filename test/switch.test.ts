import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUrl } from '../src/core/parse.ts'
import { sha256Hex } from '../src/core/sha256.ts'
import { alternatesFor, switchUrl } from '../src/core/switch.ts'

test('github pull -> diffshub keeps file and line', () => {
  const surface = parseUrl('https://github.com/o/r/pull/7/changes')!
  const url = switchUrl(surface, 'diffshub', {
    file: 'src/a.ts',
    line: 42,
    endLine: 50,
    side: 'new',
  })
  assert.equal(url, 'https://diffshub.com/o/r/pull/7#target=src/a.ts&start=A42&end=A50')
})

test('diffshub pull -> github returns to the changes tab with an anchor', () => {
  const surface = parseUrl('https://diffshub.com/o/r/pull/7')!
  const url = switchUrl(surface, 'github', {
    file: 'src/a.ts',
    line: 42,
    side: 'new',
  })
  const hash = sha256Hex('src/a.ts')
  assert.equal(url, `https://github.com/o/r/pull/7/changes#diff-${hash}R42`)
})

test('old-side lines map L <-> D', () => {
  const toGithub = switchUrl(parseUrl('https://diffshub.com/o/r/commit/deadbeef')!, 'github', { file: 'src/a.ts', line: 10, side: 'old' })
  assert.equal(toGithub, `https://github.com/o/r/commit/deadbeef#diff-${sha256Hex('src/a.ts')}L10`)

  const toDiffs = switchUrl(parseUrl('https://github.com/o/r/pull/1/changes')!, 'diffshub', { file: 'src/a.ts', line: 10, side: 'old' })
  assert.equal(toDiffs, 'https://diffshub.com/o/r/pull/1#target=src/a.ts&start=D10')
})

test('commits and compares switch without changing their shape', () => {
  const commit = parseUrl('https://github.com/o/r/commit/abc1234')!
  assert.equal(switchUrl(commit, 'diffshub'), 'https://diffshub.com/o/r/commit/abc1234')

  const compare = parseUrl('https://diffshub.com/torvalds/linux/compare/v6.0...v7.0')!
  assert.equal(switchUrl(compare, 'github'), 'https://github.com/torvalds/linux/compare/v6.0...v7.0')
})

test('npm surfaces swap canonically', () => {
  const pkg = parseUrl('https://www.npmjs.com/package/vue')!
  assert.equal(switchUrl(pkg, 'npmx'), 'https://npmx.dev/package/vue')

  const scoped = parseUrl('https://npmx.dev/package/@nuxt/kit/v/4.0.0')!
  assert.equal(switchUrl(scoped, 'npm'), 'https://www.npmjs.com/package/@nuxt/kit/v/4.0.0')

  const search = parseUrl('https://npmx.dev/search?q=vue+router')!
  assert.equal(switchUrl(search, 'npm'), 'https://www.npmjs.com/search?q=vue%20router')
})

test('npmx-only views have no npm equivalent', () => {
  const diff = parseUrl('https://npmx.dev/diff/vue/v/3.5.26...3.5.27')!
  assert.equal(switchUrl(diff, 'npm'), null)
  const alternates = alternatesFor(diff)
  assert.equal(alternates[0]?.available, false)
  assert.match(alternates[0]?.note ?? '', /version-diff/)

  // Switching to its own surface is a no-op, not a failure.
  assert.equal(switchUrl(diff, 'npmx'), diff.url.href)
})

test('alternates carry state for the rail', () => {
  const surface = parseUrl('https://diffshub.com/o/r/pull/7#target=src/a.ts&start=A42')!
  const state = { file: 'src/a.ts', line: 42, side: 'new' as const }
  const [alternate] = alternatesFor(surface, state)
  assert.equal(alternate?.id, 'github')
  assert.equal(alternate?.url, `https://github.com/o/r/pull/7/changes#diff-${sha256Hex('src/a.ts')}R42`)
})
