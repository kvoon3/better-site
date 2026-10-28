import { parseGitHubHash } from '../core/anchors.ts'
import { parseUrl, parseUrlState, surfaceLabel } from '../core/parse.ts'
import { sha256Hex } from '../core/sha256.ts'
import { alternatesFor } from '../core/switch.ts'
import type { Surface, ViewState } from '../core/types.ts'
import { defaultSettings, readSettings, type ExtensionSettings } from './settings.ts'
import { buildEmpty, buildError, buildMeta, buildSpinner, buildStack, mountRail, type RailAction, type RailHandle } from './rail.ts'

interface DepsPayload {
  status: 'ok' | 'error'
  message?: string
  refs?: {
    before: { repo: string; sha: string; short: string }
    after: { repo: string; sha: string; short: string }
    label: string
  }
  analysis?: {
    changes: Array<{
      name: string
      from?: string
      to?: string
      kind: 'bump' | 'added' | 'removed' | 'range'
      major: boolean
      source: string
      section?: string
      multiple?: boolean
    }>
    sources: string[]
    notes: string[]
  }
}

interface RefHints {
  headSha?: string
  headRepo?: string
  baseBranch?: string
}

interface SourcePayload {
  status: 'ok' | 'error'
  message?: string
  kind?: 'exact' | 'guess'
  url?: string
  repo?: string
  from?: string
  to?: string
  note?: string
}

const githubFileCache = new Map<string, string>()

const SEND_TIMEOUT_MS = 8_000
const SETTINGS_TIMEOUT_MS = 1_000

let rail: RailHandle | null = null
let renderToken = 0
/** URL whose rail state is already on screen, so idle ticks stay free */
let activeHref = ''
/** Whether that URL is supposed to have a rail (false for unsupported pages) */
let wantRail = false
let railEnabled = true
let settingsReady = false

function timeout<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function send(message: Record<string, unknown>): Promise<any> {
  try {
    const reply = chrome.runtime.sendMessage(message).catch(() => null)
    // A message that never settles (service worker still booting) must not hold
    // the caller forever, so the UI never depends on the reply to show up
    return Promise.race([reply, timeout(SEND_TIMEOUT_MS, null)])
  } catch {
    return Promise.resolve(null)
  }
}

function resolveGitHubFile(hash: string): string | undefined {
  const key = `${location.pathname}:${hash}`
  const cached = githubFileCache.get(key)
  if (cached) return cached

  const seen = new Set<string>()
  let inspected = 0
  for (const node of document.querySelectorAll('[data-path]')) {
    const path = node.getAttribute('data-path')
    if (!path || seen.has(path)) continue
    seen.add(path)
    if (sha256Hex(path) === hash) {
      githubFileCache.set(key, path)
      return path
    }
    if (++inspected >= 3000) break
  }
  return undefined
}

/** URL state plus the file GitHub only exposes through the rendered page */
function getState(surface: Surface): ViewState {
  const urlState = parseUrlState(surface)
  if (surface.id !== 'github') return urlState

  const hashState = parseGitHubHash(location.hash)
  const file = hashState.fileHash ? resolveGitHubFile(hashState.fileHash) : undefined
  const { fileHash: _fileHash, ...rest } = hashState
  return { ...urlState, ...rest, file: file ?? undefined }
}

function findPrPayload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || depth > 8) return null
  const record = value as Record<string, unknown>
  if (typeof record.headSha === 'string' && typeof record.baseBranch === 'string') {
    return record
  }
  for (const child of Object.values(record)) {
    const found = findPrPayload(child, depth + 1)
    if (found) return found
  }
  return null
}

/**
 * GitHub embeds the PR head SHA and base branch in the page. They are used as a
 * fallback when the anonymous API budget is exhausted, with no extra request needed.
 */
function extractPrHints(): RefHints | undefined {
  if (location.hostname !== 'github.com') return undefined
  const script = document.querySelector('script[data-target="react-app.embeddedData"]')
  if (!(script instanceof HTMLScriptElement) || !script.textContent) return undefined
  try {
    const pr = findPrPayload(JSON.parse(script.textContent))
    if (!pr) return undefined
    const headSha = typeof pr.headSha === 'string' ? pr.headSha : undefined
    const baseBranch = typeof pr.baseBranch === 'string' ? pr.baseBranch : undefined
    const owner = typeof pr.headRepositoryOwnerLogin === 'string' ? pr.headRepositoryOwnerLogin : undefined
    const name = typeof pr.headRepositoryName === 'string' ? pr.headRepositoryName : undefined
    if (!headSha || !baseBranch) return undefined
    return {
      headSha,
      baseBranch,
      headRepo: owner && name ? `${owner}/${name}` : undefined,
    }
  } catch {
    return undefined
  }
}

function isExactVersion(value: string | undefined): boolean {
  return value != null && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.+-]+)?$/.test(value)
}

function encodeVersion(value: string): string {
  return encodeURIComponent(value)
}

function dependencyTarget(change: NonNullable<DepsPayload['analysis']>['changes'][number]): { url: string; label: string } | null {
  const base = `https://npmx.dev/package/${change.name}`
  if (change.kind === 'bump' && isExactVersion(change.from) && isExactVersion(change.to)) {
    return {
      url: `https://npmx.dev/diff/${change.name}/v/${encodeVersion(change.from!)}...${encodeVersion(change.to!)}`,
      label: 'Diff',
    }
  }
  if (change.kind === 'added' && isExactVersion(change.to)) {
    return { url: `${base}/v/${encodeVersion(change.to!)}`, label: 'View' }
  }
  if (change.kind === 'removed' && isExactVersion(change.from)) {
    return { url: `${base}/v/${encodeVersion(change.from!)}`, label: 'View' }
  }
  if (change.kind === 'range') {
    return { url: base, label: 'Open' }
  }
  return { url: base, label: 'Open' }
}

async function switchTo(url: string): Promise<void> {
  await send({ type: 'switch', url })
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

function renderDeps(payload: DepsPayload): HTMLElement {
  const children: HTMLElement[] = []
  const refs = payload.refs
  const analysis = payload.analysis
  const changes = analysis?.changes ?? []

  if (refs) {
    children.push(buildMeta(`${refs.before.short} → ${refs.after.short} · ${refs.label}`))
  }

  if (!changes.length) {
    children.push(buildEmpty('No dependency changes in the root package.json or lockfiles.'))
  } else {
    const list = element('div', 'list')
    for (const change of changes) {
      const row = element('div', 'dep')
      const name = element('div', 'name', change.name)
      const version = element('div', 'ver', change.kind === 'bump' ? `${change.from} → ${change.to}` : change.kind === 'added' ? `added ${change.to ?? ''}` : change.kind === 'removed' ? `removed ${change.from ?? ''}` : `${change.from ?? ''} → ${change.to ?? ''}`)
      const actions = element('div', 'dep-actions')

      if (change.major) {
        actions.append(element('span', 'badge major', 'major'))
      } else if (change.multiple) {
        actions.append(element('span', 'badge', 'multi'))
      }

      const target = dependencyTarget(change)
      if (target) {
        const button = element('button', 'btn', target.label) as HTMLButtonElement
        button.type = 'button'
        button.title = `Open ${target.url}`
        button.addEventListener('click', () => {
          void switchTo(target.url)
        })
        const external = element('a', 'iconbtn', '↗') as HTMLAnchorElement
        external.href = target.url
        external.target = '_blank'
        external.rel = 'noopener noreferrer'
        external.title = 'Open in a new tab'
        actions.append(button, external)
      }

      row.append(name, version, actions)
      list.append(row)
    }
    children.push(list)
  }

  const footer = element('div', 'footer')
  const sources = analysis?.sources?.length ? `From ${analysis.sources.join(', ')}` : 'No lockfile or manifest'
  footer.append(element('span', undefined, sources))
  if (analysis?.notes?.length) {
    footer.append(element('span', undefined, analysis.notes.join(' ')))
  }
  children.push(footer)

  return buildStack(children)
}

function renderSource(payload: SourcePayload): HTMLElement {
  if (payload.status !== 'ok' || !payload.url) {
    return buildStack([buildError(payload.message ?? 'Could not resolve the source diff.')])
  }

  const wrapper = element('div', 'source')
  wrapper.append(element('div', 'kicker', payload.kind === 'exact' ? 'Exact · matched by provenance' : 'Guess · matched by release tags'))
  const target = [payload.repo, payload.from, payload.to].filter(Boolean).join(' · ')
  wrapper.append(element('div', 'target', target))
  if (payload.note) wrapper.append(element('div', 'kicker', payload.note))

  const actions = element('div', 'row')
  const open = element('button', 'btn', 'Open source diff') as HTMLButtonElement
  open.type = 'button'
  open.addEventListener('click', () => {
    void switchTo(payload.url!)
  })
  const external = element('a', 'iconbtn', '↗ new tab') as HTMLAnchorElement
  external.href = payload.url
  external.target = '_blank'
  external.rel = 'noopener noreferrer'
  actions.append(open, external)
  wrapper.append(actions)

  return buildStack([wrapper])
}

async function openDeps(handle: RailHandle, href: string): Promise<void> {
  handle.openPanel('Dependencies', buildSpinner('Reading dependency changes…'))
  const payload = (await send({
    type: 'resolve-deps',
    url: href,
    hints: extractPrHints(),
  })) as DepsPayload | null
  if (!payload || rail !== handle || location.href !== href) return
  if (payload.status !== 'ok') {
    handle.openPanel('Dependencies', buildError(payload.message ?? 'Failed to read dependencies.'))
    return
  }
  handle.openPanel('Dependencies', renderDeps(payload))
}

async function openSource(handle: RailHandle, href: string): Promise<void> {
  handle.openPanel('Source diff', buildSpinner('Resolving source repository…'))
  const payload = (await send({ type: 'resolve-source', url: href })) as SourcePayload | null
  if (!payload || rail !== handle || location.href !== href) return
  handle.openPanel('Source diff', renderSource(payload))
}

function bridgeLabel(surface: Surface): string | null {
  if (surface.family === 'git') return 'Deps'
  if (surface.kind === 'diff') return 'Source'
  if (surface.kind === 'version') return 'Source'
  return null
}

async function openCurrentBridge(): Promise<void> {
  const surface = parseUrl(location.href)
  if (!surface) return
  const label = bridgeLabel(surface)
  if (!label) return
  if (!rail || !rail.host.isConnected) sync(true)
  const handle = rail
  if (!handle) return
  const href = location.href
  if (surface.family === 'git') await openDeps(handle, href)
  else await openSource(handle, href)
}

function backLabel(url: string): string {
  const surface = parseUrl(url)
  return surface ? `↩ ${surfaceLabel(surface.id)}` : '↩ Back'
}

function teardown(): void {
  rail?.destroy()
  rail = null
  wantRail = false
  activeHref = ''
}

/** Mount the rail for `href`. Everything here is local, so it never waits on the background */
function mount(href: string): boolean {
  const surface = parseUrl(href)
  if (!surface) return false

  const state = getState(surface)
  const alternates = alternatesFor(surface, state)

  const hotkey = surface.family === 'git' ? 'Alt+Shift+D' : 'Alt+Shift+N'
  const actions: RailAction[] = alternates
    .filter((alternate) => alternate.available && alternate.url)
    .map((alternate) => ({
      label: alternate.label,
      title: alternate.note ?? `Switch to ${alternate.label} (${hotkey})`,
      onClick: () => {
        // Recompute at click time: GitHub lazy-loads file containers, so the
        // file anchor may only become resolvable after the rail was rendered
        const fresh = alternatesFor(surface, getState(surface))[0]
        if (fresh?.url) void switchTo(fresh.url)
      },
    }))

  const label = bridgeLabel(surface)
  const bridge: RailAction | undefined = label
    ? {
        label,
        title: 'Open the bridge panel (Alt+Shift+B)',
        onClick: () => {
          void openCurrentBridge()
        },
      }
    : undefined

  if (!actions.length && !bridge) return false

  rail = mountRail({
    currentLabel: surfaceLabel(surface.id),
    actions,
    bridge,
  })
  return true
}

async function attachBack(handle: RailHandle, href: string, token: number): Promise<void> {
  const back = await send({ type: 'get-back' })
  if (token !== renderToken || rail !== handle || location.href !== href) return
  if (typeof back?.url !== 'string') return
  handle.setBack({
    label: backLabel(back.url),
    title: `Back to ${back.url}`,
    onClick: () => {
      void send({ type: 'switch-back' })
    },
  })
}

function render(): void {
  const token = ++renderToken
  const href = location.href
  teardown()

  if (!railEnabled) {
    activeHref = href
    return
  }

  let mounted = false
  try {
    mounted = mount(href)
  } catch {
    // A page we cannot render must not retry on every tick
    teardown()
    activeHref = href
    return
  }

  const handle = rail
  wantRail = mounted && handle != null
  activeHref = href
  if (wantRail && handle) void attachBack(handle, href, token)
}

/** Keep the rail in step with the URL, and repair it when the page or a teardown removed it */
function sync(force = false): void {
  if (!settingsReady) return
  const href = location.href
  const healthy = activeHref === href && (wantRail ? rail?.host.isConnected === true : rail == null)
  if (!force && healthy) return
  render()
}

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return

  if (message.type === 'get-state') {
    const surface = parseUrl(location.href)
    sendResponse({ state: surface ? getState(surface) : {} })
    return false
  }

  if (message.type === 'open-bridge') {
    void openCurrentBridge()
    sendResponse({ ok: true })
    return false
  }

  return false
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.showRail) return
  railEnabled = changes.showRail.newValue !== false
  if (settingsReady) sync(true)
})

window.addEventListener('popstate', () => sync())
window.addEventListener('hashchange', () => sync())
window.addEventListener('pageshow', () => sync(true))
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) sync()
})
window.setInterval(() => sync(), 500)

async function start(): Promise<void> {
  const settings = await Promise.race([readSettings(), timeout<ExtensionSettings | null>(SETTINGS_TIMEOUT_MS, null)])
  railEnabled = settings?.showRail ?? defaultSettings.showRail
  settingsReady = true
  sync(true)
}

void start()
