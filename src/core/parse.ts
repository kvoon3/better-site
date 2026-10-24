import { parseDiffshubHash, parseGitHubHash, parseNpmxLineHash } from './anchors.ts'
import type { Surface, SurfaceId, ViewState } from './types.ts'

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const DIFFSHUB_HOSTS = new Set(['diffshub.com'])
const NPM_HOSTS = new Set(['npmjs.com', 'www.npmjs.com'])
const NPMX_HOSTS = new Set(['npmx.dev', 'xnpmjs.com'])

/** Top-level npmx routes that are not package short links */
const NPMX_RESERVED = new Set(['about', 'accessibility', 'blog', 'brand', 'compare', 'noodles', 'org', 'package', 'package-changelog', 'package-code', 'package-docs', 'package-stats', 'package-timeline', 'pds', 'privacy', 'recharging', 'search', 'settings', 'sponsors', 'tools', 'translation-status'])

function stripDiffExtension(value: string): string {
  return value.replace(/\.(diff|patch)$/i, '')
}

function splitPath(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean)
}

function decodeSegment(value: string | undefined): string | undefined {
  if (value == null) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function parseRepoActions(segments: string[]): Pick<Surface, 'kind' | 'number' | 'sha' | 'range'> | null {
  const action = segments[2]
  if (action === 'pull' && segments[3]) {
    const number = stripDiffExtension(segments[3])
    if (!/^\d+$/.test(number)) return null
    return { kind: 'pull', number }
  }
  if (action === 'commit' && segments[3]) {
    const sha = stripDiffExtension(segments[3])
    if (!/^[0-9a-f]{4,40}$/i.test(sha)) return null
    return { kind: 'commit', sha }
  }
  if (action === 'compare' && segments.length >= 4) {
    const range = decodeSegment(stripDiffExtension(segments.slice(3).join('/')))
    if (!range || !range.includes('...')) return null
    return { kind: 'compare', range }
  }
  return null
}

function parseGitHub(url: URL): Surface | null {
  if (url.searchParams.has('domain')) return null
  const segments = splitPath(url)
  if (segments.length < 3) return null
  const owner = segments[0]!
  const repo = stripDiffExtension(segments[1]!)
  const action = parseRepoActions(segments)
  if (!action) return null
  return {
    id: 'github',
    family: 'git',
    url,
    repo: { owner, repo },
    ...action,
  }
}

function parseDiffshub(url: URL): Surface | null {
  // `?domain=` renders other forges (currently Tangled). There is no matching
  // GitHub path to switch to, so the bridge stays out of the way
  if (url.searchParams.has('domain')) return null
  const segments = splitPath(url)
  if (segments.length < 2) return null
  const owner = segments[0]!
  const repo = segments[1]!
  const action = parseRepoActions(segments)
  if (!action) return null
  return {
    id: 'diffshub',
    family: 'git',
    url,
    repo: { owner, repo },
    ...action,
  }
}

/** Read `<pkg>` or `@scope/name` starting at `index` */
function readPackageName(segments: string[], index: number): { pkg: string; next: number } | null {
  const first = segments[index]
  if (!first) return null
  if (first.startsWith('@')) {
    const second = segments[index + 1]
    if (!second) return null
    return { pkg: `${first}/${second}`, next: index + 2 }
  }
  return { pkg: first, next: index + 1 }
}

function parseNpm(url: URL): Surface | null {
  const segments = splitPath(url)
  const first = segments[0]

  if (first === 'package') {
    const parsed = readPackageName(segments, 1)
    if (!parsed) return null
    const rest = segments.slice(parsed.next)
    const version = rest[0] === 'v' && rest[1] ? decodeSegment(rest[1]) : undefined
    return {
      id: 'npm',
      family: 'npm',
      kind: version ? 'version' : 'package',
      url,
      pkg: decodeSegment(parsed.pkg),
      version,
    }
  }

  if (first?.startsWith('~') && first.length > 1) {
    return {
      id: 'npm',
      family: 'npm',
      kind: 'user',
      url,
      user: decodeSegment(first.slice(1)),
    }
  }

  if (first === 'org' && segments[1]) {
    return {
      id: 'npm',
      family: 'npm',
      kind: 'org',
      url,
      org: decodeSegment(segments[1]),
    }
  }

  if (first === 'search') {
    return {
      id: 'npm',
      family: 'npm',
      kind: 'search',
      url,
      query: url.searchParams.get('q') ?? '',
    }
  }

  return null
}

function parseNpmxShortForm(url: URL, segments: string[]): Surface | null {
  if (segments.length === 1) {
    const only = segments[0]!
    if (NPMX_RESERVED.has(only)) return null
    if (only.startsWith('@')) {
      return {
        id: 'npmx',
        family: 'npm',
        kind: 'org',
        url,
        org: decodeSegment(only.slice(1)),
      }
    }
    const at = only.lastIndexOf('@')
    if (at > 0) {
      return {
        id: 'npmx',
        family: 'npm',
        kind: 'version',
        url,
        pkg: decodeSegment(only.slice(0, at)),
        version: decodeSegment(only.slice(at + 1)),
      }
    }
    return { id: 'npmx', family: 'npm', kind: 'package', url, pkg: decodeSegment(only) }
  }

  if (segments.length === 2 && segments[0]!.startsWith('@') && segments[1]!.includes('@')) {
    const only = segments[1]!
    const at = only.lastIndexOf('@')
    return {
      id: 'npmx',
      family: 'npm',
      kind: 'version',
      url,
      pkg: `${decodeSegment(segments[0]!)}/${decodeSegment(only.slice(0, at))}`,
      version: decodeSegment(only.slice(at + 1)),
    }
  }

  if (segments.length === 2 && segments[0]!.startsWith('@')) {
    return {
      id: 'npmx',
      family: 'npm',
      kind: 'package',
      url,
      pkg: `${decodeSegment(segments[0]!)}/${decodeSegment(segments[1]!)}`,
    }
  }

  return null
}

function parseNpmx(url: URL): Surface | null {
  const segments = splitPath(url)
  const first = segments[0]
  if (!first) return null

  if (first === 'package' || first === 'package-changelog' || first === 'package-stats' || first === 'package-timeline') {
    const parsed = readPackageName(segments, 1)
    if (!parsed) return null
    const rest = segments.slice(parsed.next)
    const version = rest[0] === 'v' && rest[1] ? decodeSegment(rest[1]) : undefined
    return {
      id: 'npmx',
      family: 'npm',
      kind: version ? 'version' : 'package',
      url,
      pkg: decodeSegment(parsed.pkg),
      version,
    }
  }

  if (first === 'package-code') {
    const parsed = readPackageName(segments, 1)
    if (!parsed) return null
    const rest = segments.slice(parsed.next)
    if (rest[0] !== 'v' || !rest[1]) return null
    const file = rest.slice(2).map(decodeSegment).join('/')
    return {
      id: 'npmx',
      family: 'npm',
      kind: 'code',
      url,
      pkg: decodeSegment(parsed.pkg),
      version: decodeSegment(rest[1]),
      file: file || undefined,
    }
  }

  if (first === 'diff') {
    const parsed = readPackageName(segments, 1)
    if (!parsed) return null
    const rest = segments.slice(parsed.next)
    if (rest[0] !== 'v' || !rest[1]) return null
    const range = decodeSegment(rest[1]) ?? ''
    const [from, to] = range.split('...')
    return {
      id: 'npmx',
      family: 'npm',
      kind: 'diff',
      url,
      pkg: decodeSegment(parsed.pkg),
      from,
      to,
      range,
    }
  }

  if (first?.startsWith('~') && first.length > 1) {
    return {
      id: 'npmx',
      family: 'npm',
      kind: 'user',
      url,
      user: decodeSegment(first.slice(1)),
    }
  }

  if (first === 'org' && segments[1]) {
    return {
      id: 'npmx',
      family: 'npm',
      kind: 'org',
      url,
      org: decodeSegment(segments[1]),
    }
  }

  if (first === 'search') {
    return {
      id: 'npmx',
      family: 'npm',
      kind: 'search',
      url,
      query: url.searchParams.get('q') ?? '',
    }
  }

  return parseNpmxShortForm(url, segments)
}

/** Parse a URL into a known surface, or null when the bridge has nothing to do */
export function parseUrl(raw: string): Surface | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()

  if (GITHUB_HOSTS.has(host)) return parseGitHub(url)
  if (DIFFSHUB_HOSTS.has(host)) return parseDiffshub(url)
  if (NPM_HOSTS.has(host)) return parseNpm(url)
  if (NPMX_HOSTS.has(host)) return parseNpmx(url)
  return null
}

/** Extract file/line state that is encoded directly in the URL */
export function parseUrlState(surface: Surface): ViewState {
  const { url } = surface
  switch (surface.id) {
    case 'diffshub':
      return parseDiffshubHash(url.hash)
    case 'github':
      return parseGitHubHash(url.hash)
    case 'npmx': {
      if (surface.kind === 'code') {
        return { file: surface.file, ...parseNpmxLineHash(url.hash) }
      }
      if (surface.kind === 'diff') {
        const file = url.searchParams.get('file')
        return file ? { file } : {}
      }
      return {}
    }
    default:
      return {}
  }
}

export function surfaceLabel(id: SurfaceId): string {
  switch (id) {
    case 'github':
      return 'GitHub'
    case 'diffshub':
      return 'DiffsHub'
    case 'npm':
      return 'npm'
    case 'npmx':
      return 'npmx'
  }
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

export function encodeRange(range: string): string {
  return range
    .split('...')
    .map((part) => encodeURIComponent(part).replaceAll('%3A', ':'))
    .join('...')
}
