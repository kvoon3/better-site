import { sha256Hex } from './sha256.ts'
import type { LineSide, ViewState } from './types.ts'

const GITHUB_FILE_HASH = /^#diff-([a-f0-9]{64})(?:(R|L)(\d+)(?:-(?:R|L)?(\d+))?)?$/i

export interface GitHubHashState extends ViewState {
  fileHash?: string
}

/** Parse GitHub's `#diff-<sha256(path)>R42` style file/line anchor */
export function parseGitHubHash(hash: string): GitHubHashState {
  const match = GITHUB_FILE_HASH.exec(hash)
  if (!match) return {}
  const side: LineSide = match[2]?.toUpperCase() === 'L' ? 'old' : 'new'
  const line = match[3] ? Number.parseInt(match[3], 10) : undefined
  const endLine = match[4] ? Number.parseInt(match[4], 10) : undefined
  return {
    fileHash: match[1]!.toLowerCase(),
    side: line == null ? undefined : side,
    line: Number.isSafeInteger(line) ? line : undefined,
    endLine: Number.isSafeInteger(endLine) ? endLine : undefined,
  }
}

export function buildGitHubHash(state: ViewState): string {
  if (!state.file) return ''
  const hash = sha256Hex(state.file)
  if (!state.line) return `#diff-${hash}`
  const side = state.side === 'old' ? 'L' : 'R'
  const end = state.endLine && state.endLine !== state.line ? `-${side}${state.endLine}` : ''
  return `#diff-${hash}${side}${state.line}${end}`
}

const LINE_POINT = /^([AD])(\d+)$/

/** Parse DiffsHub's `#target=<path>&start=A42&end=A50` anchor */
export function parseDiffshubHash(hash: string): ViewState {
  const text = hash.startsWith('#') ? hash.slice(1) : hash
  if (!text) return {}
  const params = new URLSearchParams(text)
  const file = params.get('target') ?? undefined
  const start = params.get('start')
  const end = params.get('end')
  const startMatch = start ? LINE_POINT.exec(start) : null
  if (!file || !startMatch) return { file }
  const side: LineSide = startMatch[1] === 'D' ? 'old' : 'new'
  const line = Number.parseInt(startMatch[2]!, 10)
  const endMatch = end ? LINE_POINT.exec(end) : null
  const endLine = endMatch ? Number.parseInt(endMatch[2]!, 10) : undefined
  return {
    file,
    side,
    line: Number.isSafeInteger(line) ? line : undefined,
    endLine: Number.isSafeInteger(endLine) ? endLine : undefined,
  }
}

export function buildDiffshubHash(state: ViewState): string {
  if (!state.file) return ''
  const side = state.side === 'old' ? 'D' : 'A'
  const line = state.line ?? 1
  const params = new URLSearchParams()
  params.set('target', state.file)
  params.set('start', `${side}${line}`)
  if (state.endLine && state.endLine !== line) {
    params.set('end', `${side}${state.endLine}`)
  }
  return `#${params.toString().replaceAll('%2F', '/')}`
}

const NPMX_LINE_HASH = /^#L(\d+)(?:-L?(\d+))?$/

/** Parse npmx's code-viewer `#L10-L20` anchor */
export function parseNpmxLineHash(hash: string): ViewState {
  const match = NPMX_LINE_HASH.exec(hash)
  if (!match) return {}
  const line = Number.parseInt(match[1]!, 10)
  const endLine = match[2] ? Number.parseInt(match[2], 10) : undefined
  return {
    side: 'new',
    line: Number.isSafeInteger(line) ? line : undefined,
    endLine: Number.isSafeInteger(endLine) ? endLine : undefined,
  }
}

export function buildNpmxLineHash(state: ViewState): string {
  if (!state.line) return ''
  const end = state.endLine && state.endLine !== state.line ? `-L${state.endLine}` : ''
  return `#L${state.line}${end}`
}
