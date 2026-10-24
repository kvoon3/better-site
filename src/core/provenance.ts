import type { RepoRef } from './types.ts'

const SLSA_V1 = 'https://slsa.dev/provenance/v1'
const SLSA_V02 = 'https://slsa.dev/provenance/v0.2'

export interface VersionProvenance {
  hasAttestation: boolean
  repo?: RepoRef
  commit?: string
  provider?: string
}

/** Parse a repository field from package.json or an attestation */
export function parseGithubRepo(input: unknown): RepoRef | null {
  let raw: string | undefined
  if (typeof input === 'string') {
    raw = input
  } else if (input && typeof input === 'object' && 'url' in input) {
    const url = (input as { url?: unknown }).url
    if (typeof url === 'string') raw = url
  }
  if (!raw) return null

  let normalized = raw.trim().replace(/^git\+/, '')
  if (/^github:/i.test(normalized)) {
    normalized = `https://github.com/${normalized.slice('github:'.length)}`
  }
  const marker = normalized.toLowerCase().indexOf('github.com')
  if (marker < 0) return null
  const rest = normalized.slice(marker + 'github.com'.length).replace(/^[/:]/, '')
  const [owner, repoRaw] = rest.split('/')
  if (!owner || !repoRaw) return null
  const repo = repoRaw.replace(/\.git$/i, '')
  if (!owner || !repo) return null
  return { owner, repo }
}

function decodePayload(payload: string): unknown {
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

type Json = Record<string, any>

/** Read the source repository + commit out of an npm attestations response */
export function parseProvenance(json: unknown): VersionProvenance {
  const list = (json as Json | null)?.attestations
  if (!Array.isArray(list)) return { hasAttestation: false }

  const item = list.find((entry) => entry?.predicateType === SLSA_V1) ?? list.find((entry) => entry?.predicateType === SLSA_V02)
  if (!item) return { hasAttestation: false }

  const payload = item?.bundle?.dsseEnvelope?.payload
  if (typeof payload !== 'string') return { hasAttestation: true }

  const decoded = decodePayload(payload) as Json | null
  const predicate = decoded?.predicate as Json | undefined
  if (!predicate) return { hasAttestation: true }

  const workflow = predicate.buildDefinition?.externalParameters?.workflow as Json | undefined
  const repo = parseGithubRepo(workflow?.repository) ?? parseGithubRepo(predicate.invocation?.configSource?.repository)

  const resolved = predicate.buildDefinition?.resolvedDependencies as Json[] | undefined
  const commit = resolved?.[0]?.digest?.gitCommit

  const builder = String(predicate.runDetails?.builder?.id ?? predicate.builder?.id ?? '')

  return {
    hasAttestation: true,
    repo: repo ?? undefined,
    commit: typeof commit === 'string' && /^[0-9a-f]{7,40}$/i.test(commit) ? commit : undefined,
    provider: /github/i.test(builder) ? 'github' : undefined,
  }
}

export function buildCompareUrl(repo: RepoRef, from: string, to: string): string {
  return `https://diffshub.com/${repo.owner}/${repo.repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`
}

export function buildCommitUrl(repo: RepoRef, sha: string): string {
  return `https://diffshub.com/${repo.owner}/${repo.repo}/commit/${encodeURIComponent(sha)}`
}

/** Fallback when provenance is missing: guess release tags from versions */
export function buildTagCompareUrl(repo: RepoRef, fromVersion: string, toVersion: string): string {
  return buildCompareUrl(repo, `v${fromVersion}`, `v${toVersion}`)
}
