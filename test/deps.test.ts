import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeDependencies } from '../src/core/deps.ts'

function lock(packages: Record<string, string>): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(Object.entries(packages).map(([name, version]) => [`node_modules/${name}`, { version }])),
  })
}

function manifest(deps: Record<string, string>): string {
  return JSON.stringify({ dependencies: deps })
}

test('lockfile bumps, additions and removals', () => {
  const before = lock({
    vue: '3.4.0',
    lodash: '4.17.20',
    removed: '1.0.0',
  })
  const after = lock({
    vue: '3.5.0',
    lodash: '4.17.21',
    added: '1.2.3',
  })

  const analysis = analyzeDependencies({
    'package-lock.json': { before, after },
  })

  const byName = new Map(analysis.changes.map((change) => [change.name, change]))
  assert.equal(byName.get('vue')?.kind, 'bump')
  assert.equal(byName.get('vue')?.from, '3.4.0')
  assert.equal(byName.get('vue')?.to, '3.5.0')
  assert.equal(byName.get('vue')?.major, false)
  assert.equal(byName.get('added')?.kind, 'added')
  assert.equal(byName.get('removed')?.kind, 'removed')
  assert.deepEqual(analysis.sources, ['package-lock.json'])
})

test('major bumps sort first', () => {
  const analysis = analyzeDependencies({
    'package-lock.json': {
      before: lock({ a: '1.0.0', b: '1.0.0' }),
      after: lock({ a: '1.1.0', b: '2.0.0' }),
    },
  })
  assert.equal(analysis.changes[0]?.name, 'b')
  assert.equal(analysis.changes[0]?.major, true)
})

test('pnpm preferred alongside stale npm lockfile without duplicating', () => {
  const pnpmBefore = `
lockfileVersion: '9.0'
packages:
  vue@3.5.0:
    resolution: {}
`
  const pnpmAfter = `
lockfileVersion: '9.0'
packages:
  vue@3.6.0:
    resolution: {}
`
  const analysis = analyzeDependencies({
    'pnpm-lock.yaml': { before: pnpmBefore, after: pnpmAfter },
    'package-lock.json': { before: lock({ vue: '3.5.0' }), after: lock({ vue: '3.6.0' }) },
  })
  assert.equal(analysis.changes.filter((change) => change.name === 'vue').length, 1)
})

test('manifest-only changes fill gaps left by lockfiles', () => {
  const analysis = analyzeDependencies({
    'package-lock.json': {
      before: lock({ vue: '3.4.0' }),
      after: lock({ vue: '3.5.0' }),
    },
    'package.json': {
      before: manifest({ vue: '^3.4.0', react: '1.0.0', 'only-range': '~1.0.0' }),
      after: manifest({ vue: '^3.5.0', react: '2.0.0', 'only-range': '~2.0.0', fresh: '1.2.3' }),
    },
  })

  const byName = new Map(analysis.changes.map((change) => [change.name, change]))
  assert.equal(byName.get('vue')?.source, 'package-lock.json')
  assert.equal(byName.get('react')?.kind, 'bump')
  assert.equal(byName.get('react')?.major, true)
  assert.equal(byName.get('only-range')?.kind, 'range')
  assert.equal(byName.get('fresh')?.kind, 'added')
})

test('no files produces a useful note', () => {
  const analysis = analyzeDependencies({})
  assert.equal(analysis.changes.length, 0)
  assert.match(analysis.notes[0] ?? '', /No root package.json/)
})
