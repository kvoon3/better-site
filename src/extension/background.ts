import { analyzeDependencies, type DependencyAnalysis } from '../core/deps.ts'
import { encodeRange, parseUrl, parseUrlState, shortSha } from '../core/parse.ts'
import { buildCommitUrl, buildCompareUrl, buildTagCompareUrl, parseGithubRepo, parseProvenance, type VersionProvenance } from '../core/provenance.ts'
import { alternatesFor } from '../core/switch.ts'
import type { RepoRef, Surface, ViewState } from '../core/types.ts'
import { readToken } from './settings.ts'

interface GitRef {
  repo: string
  sha: string
  short: string
}

interface GitRefs {
  before: GitRef
  after: GitRef
  label: string
  approximate?: boolean
}

interface RefHints {
  headSha?: string
  headRepo?: string
  baseBranch?: string
}

interface DepsResponse {
  status: 'ok' | 'error'
  message?: string
  code?: string
  refs?: GitRefs
  analysis?: DependencyAnalysis
}

interface SourceResponse {
  status: 'ok' | 'error'
  message?: string
  code?: string
  kind?: 'exact' | 'guess'
  url?: string
  repo?: string
  from?: string
  to?: string
  note?: string
}

class BridgeError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BridgeError'
    this.code = code
  }
}

const CACHE_TTL = 10 * 60_000
const MAX_RAW_FILE_BYTES = 8_000_000
const RAW_FILES = ['package.json', 'npm-shrinkwrap.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock']

const cache = new Map<string, { at: number; value: unknown }>()
const lastSwitch = new Map<number, { from: string; to: string; at: number }>()

async function getGithubToken(): Promise<string | undefined> {
  const token = (await readToken()).trim()
  return token === '' ? undefined : token
}

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value as T
  const value = await fn()
  cache.set(key, { at: Date.now(), value })
  return value
}

function toRef(repo: string, sha: string): GitRef {
  return { repo, sha, short: shortSha(sha) }
}

async function gh<T>(path: string): Promise<T> {
  const token = await getGithubToken()
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const response = await fetch(`https://api.github.com${path}`, {
    cache: 'no-store',
    headers,
  })
  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining')
    if ((response.status === 403 || response.status === 429) && remaining === '0') {
      throw new BridgeError('rate-limit', token ? 'GitHub API rate limit reached for this token. Wait for the hourly reset, then retry.' : 'GitHub API rate limit reached (60/hour anonymous). Add a token in the extension settings, then retry.')
    }
    throw new BridgeError('github', `GitHub API ${response.status} for ${path}`)
  }
  return (await response.json()) as T
}

async function resolveRefs(surface: Surface, hints?: RefHints): Promise<GitRefs> {
  const repo = `${surface.repo!.owner}/${surface.repo!.repo}`

  if (surface.kind === 'pull') {
    try {
      const pr = await gh<any>(`/repos/${repo}/pulls/${surface.number}`)
      const beforeRepo: string = pr.base?.repo?.full_name ?? repo
      const afterRepo: string = pr.head?.repo?.full_name ?? beforeRepo
      if (!pr.base?.sha || !pr.head?.sha) {
        throw new BridgeError('github', 'Pull request did not include base/head refs.')
      }
      return {
        before: toRef(beforeRepo, pr.base.sha),
        after: toRef(afterRepo, pr.head.sha),
        label: `PR #${surface.number}`,
      }
    } catch (error) {
      // The PR page embeds the head SHA and base branch. They are less precise
      // than the API's merge base, but they keep the bridge working when the
      // anonymous API budget is spent
      const canFallback = error instanceof BridgeError && error.code === 'rate-limit' && typeof hints?.headSha === 'string' && /^[0-9a-f]{7,40}$/i.test(hints.headSha) && typeof hints.baseBranch === 'string' && hints.baseBranch.length > 0
      if (!canFallback) throw error
      return {
        before: {
          repo,
          sha: hints!.baseBranch!,
          short: hints!.baseBranch!,
        },
        after: toRef(hints!.headRepo ?? repo, hints!.headSha!),
        label: `PR #${surface.number} · page fallback`,
        approximate: true,
      }
    }
  }

  if (surface.kind === 'compare') {
    const comparison = await gh<any>(`/repos/${repo}/compare/${encodeRange(surface.range ?? '')}`)
    const beforeSha: string | undefined = comparison.merge_base_commit?.sha ?? comparison.base_commit?.sha
    const commits: any[] = Array.isArray(comparison.commits) ? comparison.commits : []
    const afterSha: string | undefined = commits.at(-1)?.sha ?? comparison.base_commit?.sha
    if (!beforeSha || !afterSha) {
      throw new BridgeError('github', 'Compare response did not include commits.')
    }
    return {
      before: toRef(repo, beforeSha),
      after: toRef(repo, afterSha),
      label: surface.range ?? 'compare',
    }
  }

  if (surface.kind === 'commit') {
    const commit = await gh<any>(`/repos/${repo}/commits/${surface.sha}`)
    const parent: string = commit.parents?.[0]?.sha ?? commit.sha
    return {
      before: toRef(repo, parent),
      after: toRef(repo, commit.sha),
      label: `commit ${shortSha(commit.sha)}`,
    }
  }

  throw new BridgeError('unsupported', 'This page is not a diff.')
}

async function readRaw(ref: GitRef, file: string): Promise<string | null> {
  const token = await getGithubToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
  const response = await fetch(`https://raw.githubusercontent.com/${ref.repo}/${ref.sha}/${file}`, { cache: 'force-cache', headers })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new BridgeError('raw', `raw.githubusercontent.com ${response.status} for ${file}`)
  }
  const length = Number(response.headers.get('content-length') ?? '0')
  if (length > MAX_RAW_FILE_BYTES) return null
  const text = await response.text()
  return text.length > MAX_RAW_FILE_BYTES ? null : text
}

async function resolveDeps(surface: Surface, hints?: RefHints): Promise<DepsResponse> {
  const refs = await resolveRefs(surface, hints)
  const pairs = await Promise.all(
    RAW_FILES.map(async (file) => {
      const [before, after] = await Promise.all([readRaw(refs.before, file), readRaw(refs.after, file)])
      return [file, { before, after }] as const
    }),
  )
  const analysis = analyzeDependencies(Object.fromEntries(pairs))
  if (refs.approximate) {
    analysis.notes.push('GitHub API was rate-limited. The base is the current branch tip, so unrelated changes may appear.')
  }
  return { status: 'ok', refs, analysis }
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new BridgeError('registry', `Registry ${response.status} for ${url}`)
  }
  return response.json()
}

interface VersionMeta {
  repo?: RepoRef
  commit?: string
  provenance: VersionProvenance
}

async function versionMeta(pkg: string, version: string): Promise<VersionMeta> {
  const doc = await fetchJson(`https://registry.npmjs.org/${pkg}/${encodeURIComponent(version)}`)
  let repo = parseGithubRepo(doc?.repository) ?? undefined
  let provenance: VersionProvenance = { hasAttestation: false }

  const attestationsUrl = doc?.dist?.attestations?.url
  if (typeof attestationsUrl === 'string') {
    try {
      provenance = parseProvenance(await fetchJson(attestationsUrl))
    } catch {
      provenance = { hasAttestation: false }
    }
  }
  if (provenance.repo) repo = provenance.repo

  return { repo, commit: provenance.commit, provenance }
}

function sameRepo(a: RepoRef, b: RepoRef): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
}

async function resolveDiffSource(pkg: string, from: string, to: string): Promise<SourceResponse> {
  const [fromMeta, toMeta] = await Promise.all([versionMeta(pkg, from), versionMeta(pkg, to)])

  const bothSameRepo = fromMeta.repo && toMeta.repo && sameRepo(fromMeta.repo, toMeta.repo)
  if (bothSameRepo && fromMeta.commit && toMeta.commit) {
    return {
      status: 'ok',
      kind: 'exact',
      url: buildCompareUrl(fromMeta.repo!, fromMeta.commit, toMeta.commit),
      repo: `${fromMeta.repo!.owner}/${fromMeta.repo!.repo}`,
      from: shortSha(fromMeta.commit),
      to: shortSha(toMeta.commit),
      note: 'Matched by npm provenance (SLSA source commits).',
    }
  }

  const repo = toMeta.repo ?? fromMeta.repo
  if (repo) {
    return {
      status: 'ok',
      kind: 'guess',
      url: buildTagCompareUrl(repo, from, to),
      repo: `${repo.owner}/${repo.repo}`,
      from: `v${from}`,
      to: `v${to}`,
      note: 'No provenance for both versions; guessed release tags.',
    }
  }

  return {
    status: 'error',
    code: 'no-repo',
    message: 'Could not resolve a GitHub repository for this package.',
  }
}

async function resolveVersionSource(pkg: string, version: string): Promise<SourceResponse> {
  const meta = await versionMeta(pkg, version)
  if (meta.repo && meta.commit) {
    return {
      status: 'ok',
      kind: 'exact',
      url: buildCommitUrl(meta.repo, meta.commit),
      repo: `${meta.repo.owner}/${meta.repo.repo}`,
      to: shortSha(meta.commit),
      note: 'Matched by npm provenance (SLSA source commit).',
    }
  }
  if (meta.repo) {
    return {
      status: 'ok',
      kind: 'guess',
      url: buildCommitUrl(meta.repo, `v${version}`),
      repo: `${meta.repo.owner}/${meta.repo.repo}`,
      to: `v${version}`,
      note: 'No provenance; guessed the release tag.',
    }
  }
  return {
    status: 'error',
    code: 'no-repo',
    message: 'Could not resolve a GitHub repository for this package.',
  }
}

function errorResponse(error: unknown): { status: 'error'; message: string; code?: string } {
  if (error instanceof BridgeError) {
    return { status: 'error', message: error.message, code: error.code }
  }
  return {
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  }
}

async function resolveDepsMessage(url: string, hints?: RefHints): Promise<DepsResponse> {
  const surface = parseUrl(url)
  if (!surface || surface.family !== 'git' || !surface.repo) {
    return { status: 'error', code: 'unsupported', message: 'Not a GitHub/DiffsHub diff page.' }
  }
  const key = `deps:${url.split('#')[0]}`
  return cached(key, () => resolveDeps(surface, hints))
}

async function resolveSourceMessage(url: string): Promise<SourceResponse> {
  const surface = parseUrl(url)
  if (!surface || surface.family !== 'npm' || !surface.pkg) {
    return { status: 'error', code: 'unsupported', message: 'Not an npm/npmx page.' }
  }
  if (surface.kind === 'diff' && surface.from && surface.to) {
    return cached(`source:diff:${surface.pkg}:${surface.from}:${surface.to}`, () => resolveDiffSource(surface.pkg!, surface.from!, surface.to!))
  }
  if (surface.kind === 'version' && surface.version) {
    return cached(`source:version:${surface.pkg}:${surface.version}`, () => resolveVersionSource(surface.pkg!, surface.version!))
  }
  return {
    status: 'error',
    code: 'unsupported',
    message: 'Open a version diff or a version page to find its source.',
  }
}

async function getStateFromTab(tabId: number, surface: Surface): Promise<ViewState> {
  const base = parseUrlState(surface)
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'get-state' })
    if (response && typeof response === 'object' && response.state) {
      return { ...base, ...(response.state as ViewState) }
    }
  } catch {
    // Content script not ready, but URL state is still useful
  }
  return base
}

async function toggle(tab: chrome.tabs.Tab, family: 'git' | 'npm' | null): Promise<void> {
  if (tab.id == null || !tab.url) return
  const surface = parseUrl(tab.url)
  if (!surface) return
  if (family && surface.family !== family) return
  const state = await getStateFromTab(tab.id, surface)
  const target = alternatesFor(surface, state)[0]
  if (!target?.url) return
  await navigate(tab.id, target.url)
}

async function navigate(tabId: number, url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') return
  const tab = await chrome.tabs.get(tabId)
  if (tab.url && tab.url !== url) {
    lastSwitch.set(tabId, { from: tab.url, to: url, at: Date.now() })
  }
  await chrome.tabs.update(tabId, { url })
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

const MENUS: Array<{
  id: string
  title: string
  target: 'github' | 'diffshub' | 'npm' | 'npmx'
  patterns: string[]
}> = [
  {
    id: 'to-diffshub',
    title: 'Open in DiffsHub',
    target: 'diffshub',
    patterns: ['https://github.com/*/pull/*', 'https://github.com/*/commit/*', 'https://github.com/*/compare/*'],
  },
  {
    id: 'to-github',
    title: 'Open in GitHub',
    target: 'github',
    patterns: ['https://diffshub.com/*'],
  },
  {
    id: 'to-npmx',
    title: 'Open on npmx',
    target: 'npmx',
    patterns: ['https://www.npmjs.com/package/*', 'https://npmjs.com/package/*'],
  },
  {
    id: 'to-npm',
    title: 'Open on npm',
    target: 'npm',
    patterns: ['https://npmx.dev/package/*', 'https://xnpmjs.com/package/*'],
  },
]

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) {
      chrome.contextMenus.create({
        id: menu.id,
        title: menu.title,
        contexts: ['link'],
        targetUrlPatterns: menu.patterns,
      })
    }
  })
})

chrome.contextMenus.onClicked.addListener((info) => {
  void (async () => {
    const menu = MENUS.find((entry) => entry.id === info.menuItemId)
    if (!menu || !info.linkUrl) return
    const surface = parseUrl(info.linkUrl)
    if (!surface) return
    const state = parseUrlState(surface)
    const target = alternatesFor(surface, state).find((entry) => entry.id === menu.target)
    if (target?.url) await chrome.tabs.create({ url: target.url })
  })()
})

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    const tab = await activeTab()
    if (!tab) return
    if (command === 'toggle-git') {
      await toggle(tab, 'git')
    } else if (command === 'toggle-npm') {
      await toggle(tab, 'npm')
    } else if (command === 'open-bridge' && tab.id != null) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'open-bridge' })
      } catch {
        // No bridge on this page
      }
    }
  })()
})

chrome.action.onClicked.addListener((tab) => {
  void toggle(tab, null)
})

chrome.tabs.onRemoved.addListener((tabId) => {
  lastSwitch.delete(tabId)
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url) return
  const entry = lastSwitch.get(tabId)
  if (!entry) return
  if (changeInfo.url !== entry.from && changeInfo.url !== entry.to) {
    lastSwitch.delete(tabId)
  } else if (Date.now() - entry.at > CACHE_TTL) {
    lastSwitch.delete(tabId)
  }
})

chrome.runtime.onMessage.addListener((message: any, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return

  if (message.type === 'resolve-deps') {
    resolveDepsMessage(String(message.url ?? sender.tab?.url ?? ''), message.hints && typeof message.hints === 'object' ? message.hints : undefined)
      .then(sendResponse)
      .catch((error) => sendResponse(errorResponse(error)))
    return true
  }

  if (message.type === 'resolve-source') {
    resolveSourceMessage(String(message.url ?? sender.tab?.url ?? ''))
      .then(sendResponse)
      .catch((error) => sendResponse(errorResponse(error)))
    return true
  }

  if (message.type === 'switch') {
    const tabId = sender.tab?.id
    const url = typeof message.url === 'string' ? message.url : ''
    if (tabId == null || !url) {
      sendResponse({ ok: false })
      return false
    }
    navigate(tabId, url)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, message: String(error) }))
    return true
  }

  if (message.type === 'switch-back') {
    const tabId = sender.tab?.id
    const entry = tabId == null ? undefined : lastSwitch.get(tabId)
    if (tabId == null || !entry) {
      sendResponse({ ok: false })
      return false
    }
    lastSwitch.delete(tabId)
    chrome.tabs.update(tabId, { url: entry.from }).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, message: String(error) }),
    )
    return true
  }

  if (message.type === 'get-back') {
    const tabId = sender.tab?.id
    const current = sender.tab?.url
    const entry = tabId == null ? undefined : lastSwitch.get(tabId)
    if (entry && current === entry.to && Date.now() - entry.at < CACHE_TTL) {
      sendResponse({ url: entry.from })
    } else {
      sendResponse({})
    }
    return false
  }

  if (message.type === 'open-tab' && typeof message.url === 'string') {
    let url: URL
    try {
      url = new URL(message.url)
    } catch {
      sendResponse({ ok: false })
      return false
    }
    if (url.protocol !== 'https:') {
      sendResponse({ ok: false })
      return false
    }
    chrome.tabs.create({ url: url.href }).then(
      () => sendResponse({ ok: true }),
      (error) => sendResponse({ ok: false, message: String(error) }),
    )
    return true
  }

  return false
})
