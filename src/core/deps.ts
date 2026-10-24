import { compareVersions, exactVersion, isMajorBump, parseBunLock, parsePackageJsonDeps, parsePackageLock, parsePnpmLock, parseYarnLock, type VersionMap } from './lockfiles.ts'

export interface DependencyChange {
  name: string
  from?: string
  to?: string
  kind: 'bump' | 'added' | 'removed' | 'range'
  major: boolean
  source: string
  section?: string
  multiple?: boolean
}

export interface DependencyFilePair {
  before: string | null
  after: string | null
}

export type DependencyFiles = Record<string, DependencyFilePair>

export interface DependencyAnalysis {
  changes: DependencyChange[]
  sources: string[]
  notes: string[]
}

interface LockfileParser {
  name: string
  parse: (text: string) => VersionMap | null
}

const LOCKFILES: LockfileParser[] = [
  { name: 'pnpm-lock.yaml', parse: parsePnpmLock },
  { name: 'package-lock.json', parse: parsePackageLock },
  { name: 'npm-shrinkwrap.json', parse: parsePackageLock },
  { name: 'yarn.lock', parse: parseYarnLock },
  { name: 'bun.lock', parse: parseBunLock },
]

const MAX_CHANGES = 300

function addVersions(target: Map<string, Set<string>>, versions: VersionMap): void {
  for (const [name, version] of versions) {
    const set = target.get(name) ?? new Set<string>()
    set.add(version)
    target.set(name, set)
  }
}

function sortedVersions(set: Set<string> | undefined): string[] {
  return [...(set ?? [])].toSorted(compareVersions)
}

function describeSource(files: Iterable<string>): string {
  return [...files].join(', ')
}

/** Compare the dependency graph found by `collectDependencyChanges` */
export function analyzeDependencies(files: DependencyFiles): DependencyAnalysis {
  const before = new Map<string, Set<string>>()
  const after = new Map<string, Set<string>>()
  const sourceByName = new Map<string, Set<string>>()
  const sources: string[] = []
  const notes: string[] = []

  for (const lockfile of LOCKFILES) {
    const pair = files[lockfile.name]
    if (!pair) continue
    let used = false
    for (const [side, text] of [
      ['before', pair.before],
      ['after', pair.after],
    ] as const) {
      if (!text) continue
      const parsed = lockfile.parse(text)
      if (!parsed || parsed.size === 0) continue
      used = true
      addVersions(side === 'before' ? before : after, parsed)
      for (const name of parsed.keys()) {
        const set = sourceByName.get(name) ?? new Set<string>()
        set.add(lockfile.name)
        sourceByName.set(name, set)
      }
    }
    if (used) sources.push(lockfile.name)
  }

  const changes: DependencyChange[] = []
  const names = new Set([...before.keys(), ...after.keys()])
  for (const name of names) {
    const beforeVersions = sortedVersions(before.get(name))
    const afterVersions = sortedVersions(after.get(name))
    const from = beforeVersions.at(-1)
    const to = afterVersions.at(-1)
    const source = describeSource(sourceByName.get(name) ?? [])

    if (!from && to) {
      changes.push({ name, to, kind: 'added', major: false, source })
      continue
    }
    if (from && !to) {
      changes.push({ name, from, kind: 'removed', major: false, source })
      continue
    }
    if (!from || !to || from === to) continue

    changes.push({
      name,
      from,
      to,
      kind: 'bump',
      major: isMajorBump(from, to),
      source,
      multiple: beforeVersions.length > 1 || afterVersions.length > 1 || undefined,
    })
  }

  const manifestBeforeText = files['package.json']?.before
  const manifestAfterText = files['package.json']?.after
  const manifestBefore = manifestBeforeText ? parsePackageJsonDeps(manifestBeforeText) : null
  const manifestAfter = manifestAfterText ? parsePackageJsonDeps(manifestAfterText) : null

  if (manifestBefore && manifestAfter) {
    const seen = new Set(changes.map((change) => change.name))
    for (const [name, afterEntry] of manifestAfter) {
      if (before.has(name) || after.has(name) || seen.has(name)) continue
      const beforeEntry = manifestBefore.get(name)
      if (!beforeEntry) {
        changes.push({
          name,
          to: exactVersion(afterEntry.range) ?? afterEntry.range,
          kind: 'added',
          major: false,
          source: 'package.json',
          section: afterEntry.section,
        })
        seen.add(name)
        continue
      }
      if (beforeEntry.range === afterEntry.range) continue
      const from = exactVersion(beforeEntry.range)
      const to = exactVersion(afterEntry.range)
      changes.push({
        name,
        from: from ?? beforeEntry.range,
        to: to ?? afterEntry.range,
        kind: from && to ? 'bump' : 'range',
        major: from && to ? isMajorBump(from, to) : false,
        source: 'package.json',
        section: afterEntry.section,
      })
      seen.add(name)
    }
    for (const [name, beforeEntry] of manifestBefore) {
      if (manifestAfter.has(name) || before.has(name) || after.has(name) || seen.has(name)) {
        continue
      }
      changes.push({
        name,
        from: exactVersion(beforeEntry.range) ?? beforeEntry.range,
        kind: 'removed',
        major: false,
        source: 'package.json',
        section: beforeEntry.section,
      })
      seen.add(name)
    }
    if (!sources.length) sources.push('package.json')
  } else if (!sources.length) {
    notes.push('No root package.json or lockfile was available on both sides.')
  }

  const order = { bump: 0, added: 1, removed: 2, range: 3 } as const
  changes.sort((a, b) => {
    if (a.major !== b.major) return a.major ? -1 : 1
    if (order[a.kind] !== order[b.kind]) return order[a.kind] - order[b.kind]
    return a.name.localeCompare(b.name)
  })

  const truncated = changes.length > MAX_CHANGES
  if (truncated) {
    changes.length = MAX_CHANGES
    notes.push(`Showing the first ${MAX_CHANGES} dependency changes.`)
  }

  if (!changes.length && !notes.length) {
    notes.push('No dependency changes found in the root manifest or lockfiles.')
  }

  return { changes, sources, notes }
}
