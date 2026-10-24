import { buildDiffshubHash, buildGitHubHash } from './anchors.ts'
import { encodeRange, surfaceLabel } from './parse.ts'
import type { Alternate, Surface, SurfaceId, ViewState } from './types.ts'

function githubUrl(surface: Surface, state: ViewState): string | null {
  const repo = surface.repo
  if (!repo) return null
  const base = `https://github.com/${repo.owner}/${repo.repo}`
  let url: string
  switch (surface.kind) {
    case 'pull':
      url = `${base}/pull/${surface.number}/changes`
      break
    case 'commit':
      url = `${base}/commit/${surface.sha}`
      break
    case 'compare':
      url = `${base}/compare/${encodeRange(surface.range ?? '')}`
      break
    default:
      return null
  }
  if (state.file) url += buildGitHubHash(state)
  return url
}

function diffshubUrl(surface: Surface, state: ViewState): string | null {
  const repo = surface.repo
  if (!repo) return null
  const base = `https://diffshub.com/${repo.owner}/${repo.repo}`
  let url: string
  switch (surface.kind) {
    case 'pull':
      url = `${base}/pull/${surface.number}`
      break
    case 'commit':
      url = `${base}/commit/${surface.sha}`
      break
    case 'compare':
      url = `${base}/compare/${encodeRange(surface.range ?? '')}`
      break
    default:
      return null
  }
  if (state.file) url += buildDiffshubHash(state)
  return url
}

function npmUrl(surface: Surface, target: 'npm' | 'npmx'): string | null {
  const origin = target === 'npm' ? 'https://www.npmjs.com' : 'https://npmx.dev'
  switch (surface.kind) {
    case 'package':
      return `${origin}/package/${surface.pkg}`
    case 'version':
      return `${origin}/package/${surface.pkg}/v/${surface.version}`
    case 'user':
      return `${origin}/~${surface.user}`
    case 'org':
      return `${origin}/org/${surface.org}`
    case 'search':
      return `${origin}/search?q=${encodeURIComponent(surface.query ?? '')}`
    default:
      // npmx-only views (version diff, code viewer) have no npmjs equivalent
      return null
  }
}

function npmxOnlyUrl(surface: Surface): string | null {
  switch (surface.kind) {
    case 'diff':
      if (!surface.pkg || !surface.from || !surface.to) return null
      return `https://npmx.dev/diff/${surface.pkg}/v/${encodeURIComponent(surface.from)}...${encodeURIComponent(surface.to)}`
    case 'code':
      if (!surface.pkg || !surface.version || !surface.file) return null
      return `https://npmx.dev/package-code/${surface.pkg}/v/${surface.version}/${surface.file}`
    default:
      return null
  }
}

/** Build the URL for `target`, carrying view state across when possible */
export function switchUrl(surface: Surface, target: SurfaceId, state: ViewState = {}): string | null {
  if (surface.id === target) return surface.url.href

  if (surface.family === 'git') {
    if (target !== 'github' && target !== 'diffshub') return null
    return target === 'github' ? githubUrl(surface, state) : diffshubUrl(surface, state)
  }

  if (target !== 'npm' && target !== 'npmx') return null
  if (target === 'npmx' && (surface.kind === 'diff' || surface.kind === 'code')) {
    return npmxOnlyUrl(surface)
  }
  return npmUrl(surface, target)
}

function unavailableNote(surface: Surface): string {
  if (surface.kind === 'diff') return 'npmjs.com has no version-diff page'
  if (surface.kind === 'code') return 'npmjs.com has no line-addressable code view'
  return 'No equivalent view'
}

/** The other surface(s) for this page, with state-carrying URLs */
export function alternatesFor(surface: Surface, state: ViewState = {}): Alternate[] {
  const peer: SurfaceId = surface.family === 'git' ? (surface.id === 'github' ? 'diffshub' : 'github') : surface.id === 'npm' ? 'npmx' : 'npm'

  const url = switchUrl(surface, peer, state)
  return [
    {
      id: peer,
      label: surfaceLabel(peer),
      url,
      available: url != null,
      note: url == null ? unavailableNote(surface) : undefined,
    },
  ]
}
