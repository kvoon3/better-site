// Best-effort readers for the lockfiles people actually commit. Every parser
// returns `name -> version` and silently ignores entries it cannot understand;
// the bridge is a review aid, not an installer

export type VersionMap = Map<string, string>

const SEMVER_START = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?)/

function cleanSemver(raw: string): string | null {
  const withoutPeers = raw.replace(/\(.*$/, '').trim()
  const match = SEMVER_START.exec(withoutPeers)
  return match ? match[1]! : null
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim()
}

export function parsePackageLock(text: string): VersionMap | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof doc !== 'object' || doc === null) return null
  const out: VersionMap = new Map()
  const record = doc as Record<string, unknown>
  const packages = record.packages
  if (typeof packages === 'object' && packages !== null) {
    for (const [key, value] of Object.entries(packages as Record<string, unknown>)) {
      if (typeof value !== 'object' || value === null) continue
      const marker = 'node_modules/'
      const index = key.lastIndexOf(marker)
      if (index < 0) continue
      const name = key.slice(index + marker.length)
      if (!name || name.includes('/node_modules/')) continue
      const version = (value as Record<string, unknown>).version
      if (typeof version === 'string' && cleanSemver(version)) {
        out.set(name, cleanSemver(version)!)
      }
    }
  }
  const dependencies = record.dependencies
  if (out.size === 0 && typeof dependencies === 'object' && dependencies !== null) {
    const walk = (deps: Record<string, unknown>): void => {
      for (const [name, value] of Object.entries(deps)) {
        if (typeof value !== 'object' || value === null) continue
        const entry = value as Record<string, unknown>
        if (typeof entry.version === 'string' && cleanSemver(entry.version)) {
          out.set(name, cleanSemver(entry.version)!)
        }
        if (typeof entry.dependencies === 'object' && entry.dependencies !== null) {
          walk(entry.dependencies as Record<string, unknown>)
        }
      }
    }
    walk(dependencies as Record<string, unknown>)
  }
  return out
}

function parsePnpmKey(raw: string): { name: string; version: string } | null {
  // Peer suffixes, e.g. `vue@3.5.27(react@18.2.0)`, contain `@` and would fool
  // the separator logic. They do not affect the resolved version.
  const key = unquote(raw).replace(/\(.*$/, '')
  if (!key) return null

  if (key.startsWith('/')) {
    const rest = key.slice(1)
    let separator = rest.lastIndexOf('@')
    const slash = rest.lastIndexOf('/')
    if (separator <= 0 || slash > separator) separator = slash
    if (separator <= 0) return null
    const name = rest.slice(0, separator)
    const version = cleanSemver(rest.slice(separator + 1))
    if (!name || !version) return null
    return { name, version }
  }

  const at = key.lastIndexOf('@')
  if (at <= 0) return null
  const name = key.slice(0, at)
  const version = cleanSemver(key.slice(at + 1))
  if (!name || !version) return null
  return { name, version }
}

export function parsePnpmLock(text: string): VersionMap | null {
  const out: VersionMap = new Map()
  const lines = text.split(/\r?\n/)
  const sections = new Map<string, VersionMap>()
  let section: VersionMap | null = null
  let sectionIndent = 0

  for (const line of lines) {
    if (!line.trim()) continue
    const indent = line.length - line.trimStart().length

    if (indent === 0) {
      const match = /^(packages|snapshots):\s*$/.exec(line)
      if (match) {
        section = new Map()
        sections.set(match[1]!, section)
        sectionIndent = 0
      } else {
        section = null
      }
      continue
    }

    if (!section) continue
    if (sectionIndent === 0) sectionIndent = indent
    if (indent !== sectionIndent) continue
    if (!line.trimEnd().endsWith(':')) continue

    const parsed = parsePnpmKey(line.trim().replace(/:$/, ''))
    if (parsed) section.set(parsed.name, parsed.version)
  }

  for (const [, entries] of sections) {
    for (const [name, version] of entries) {
      if (!out.has(name)) out.set(name, version)
    }
  }
  return out.size ? out : null
}

function parseYarnSpecifier(raw: string): string | null {
  const spec = unquote(raw)
  if (!spec) return null
  if (spec.startsWith('@')) {
    const slash = spec.indexOf('/')
    if (slash < 0) return null
    const at = spec.indexOf('@', slash)
    return at < 0 ? spec : spec.slice(0, at) || null
  }
  const at = spec.indexOf('@')
  return at < 0 ? spec : spec.slice(0, at) || null
}

export function parseYarnLock(text: string): VersionMap | null {
  const out: VersionMap = new Map()
  let names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      names = []
      continue
    }
    if (line.startsWith('#')) {
      names = []
      continue
    }
    if (!/^\s/.test(line)) {
      names = line
        .replace(/:\s*$/, '')
        .split(',')
        .map(parseYarnSpecifier)
        .filter((value): value is string => value != null)
      continue
    }
    const match = /^\s+version:?\s+"?([^"\s]+)"?/.exec(line)
    if (match && names.length) {
      const version = cleanSemver(match[1]!)
      if (version) {
        for (const name of names) out.set(name, version)
      }
      names = []
    }
  }
  return out.size ? out : null
}

function parseBunId(raw: string): { name: string; version: string } | null {
  const at = raw.lastIndexOf('@')
  if (at <= 0) return null
  const name = raw.slice(0, at)
  const version = cleanSemver(raw.slice(at + 1))
  if (!name || !version) return null
  return { name, version }
}

export function parseBunLock(text: string): VersionMap | null {
  const stripped = text.replace(/^\s*\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1')
  let doc: unknown
  try {
    doc = JSON.parse(stripped)
  } catch {
    return null
  }
  if (typeof doc !== 'object' || doc === null) return null
  const packages = (doc as Record<string, unknown>).packages
  if (typeof packages !== 'object' || packages === null) return null
  const out: VersionMap = new Map()
  for (const value of Object.values(packages as Record<string, unknown>)) {
    const id = Array.isArray(value) ? value[0] : value
    if (typeof id !== 'string') continue
    const parsed = parseBunId(id)
    if (parsed) out.set(parsed.name, parsed.version)
  }
  return out.size ? out : null
}

export interface ManifestDependency {
  name: string
  range: string
  section: string
}

const DEPENDENCY_SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const

export function parsePackageJsonDeps(text: string): Map<string, ManifestDependency> | null {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof doc !== 'object' || doc === null) return null
  const out = new Map<string, ManifestDependency>()
  for (const section of DEPENDENCY_SECTIONS) {
    const deps = (doc as Record<string, unknown>)[section]
    if (typeof deps !== 'object' || deps === null) continue
    for (const [name, range] of Object.entries(deps as Record<string, unknown>)) {
      if (typeof range === 'string') out.set(name, { name, range, section })
    }
  }
  return out
}

const EXACT_VERSION = /^=?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?)$/

export function exactVersion(range: string): string | null {
  const match = EXACT_VERSION.exec(range.trim())
  return match ? match[1]! : null
}

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  pre?: string
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.+-]+))?/.exec(value)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4],
  }
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return a.localeCompare(b)
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  if (left.patch !== right.patch) return left.patch - right.patch
  if (left.pre && !right.pre) return -1
  if (!left.pre && right.pre) return 1
  return (left.pre ?? '').localeCompare(right.pre ?? '')
}

export function isMajorBump(from: string, to: string): boolean {
  const left = parseVersion(from)
  const right = parseVersion(to)
  return left != null && right != null && right.major > left.major
}
