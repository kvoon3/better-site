import * as stylex from '@stylexjs/stylex'
import { createSignal, For, onSettled, Show } from 'solid-js'
import { checkToken, clearToken, readSettings, readToken, saveShowRail, saveToken } from '../extension/settings.ts'
import { styles } from './styles.ts'
import { darkTheme } from './dark.ts'

const darkStyles = darkTheme as unknown as stylex.StyleXStyles

type StatusTone = 'muted' | 'ok' | 'error'

interface Status {
  tone: StatusTone
  text: string
}

interface Shortcut {
  name: string
  description: string
  shortcut: string
}

const fallbackShortcuts: Shortcut[] = [
  { name: 'toggle-git', description: 'Toggle GitHub and DiffsHub', shortcut: 'Alt+Shift+D' },
  { name: 'toggle-npm', description: 'Toggle npm and npmx', shortcut: 'Alt+Shift+N' },
  { name: 'open-bridge', description: 'Open the bridge panel', shortcut: 'Alt+Shift+B' },
]

const shortcutLabels: Record<string, string> = {
  'toggle-git': 'GitHub ↔ DiffsHub',
  'toggle-npm': 'npm ↔ npmx',
  'open-bridge': 'Open the bridge panel',
}

function cx(...values: Array<stylex.StyleXStyles | false | null | undefined>): string {
  return stylex.props(...values).className ?? ''
}

function readShortcuts(): Promise<Shortcut[]> {
  if (typeof chrome === 'undefined' || !chrome.commands?.getAll) {
    return Promise.resolve(fallbackShortcuts)
  }
  try {
    return chrome.commands.getAll().then((commands) => {
      if (!commands.length) return fallbackShortcuts
      return commands.map((command) => ({
        name: command.name ?? '',
        description: command.description ?? '',
        shortcut: command.shortcut ?? '',
      }))
    })
  } catch {
    return Promise.resolve(fallbackShortcuts)
  }
}

function readVersion(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    return chrome.runtime.getManifest().version
  }
  return 'dev'
}

function readProductName(): string {
  if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    return chrome.runtime.getManifest().name
  }
  return 'Better Site'
}

function canManageShortcuts(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.tabs?.create)
}

function shortcutLabel(shortcut: Shortcut): string {
  return shortcutLabels[shortcut.name] ?? shortcut.description ?? shortcut.name
}

function manageShortcuts(): void {
  if (!canManageShortcuts()) return
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
}

function KeyIcon() {
  return (
    <svg viewBox='0 0 20 20' fill='none' stroke='currentColor' stroke-width={1.7} stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' class={cx(styles.icon)}>
      <circle cx='7' cy='7' r='3' />
      <path d='m9.5 9.5 5 5M12.5 14l1.4-1.4' />
    </svg>
  )
}

function RailIcon() {
  return (
    <svg viewBox='0 0 20 20' fill='none' stroke='currentColor' stroke-width={1.7} stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' class={cx(styles.icon)}>
      <path d='M3.5 7h12M12.5 4l3 3-3 3M16.5 13h-12M7.5 10l-3 3 3 3' />
    </svg>
  )
}

function KeyboardIcon() {
  return (
    <svg viewBox='0 0 20 20' fill='none' stroke='currentColor' stroke-width={1.7} stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' class={cx(styles.icon)}>
      <rect x='2.5' y='5' width='15' height='10' rx='2' />
      <path d='M5.5 8.5h.01M8.5 8.5h.01M11.5 8.5h.01M14.5 8.5h.01M5.5 12h.01M14.5 12h.01M8 12h4' />
    </svg>
  )
}

export function App() {
  const [token, setToken] = createSignal('')
  const [revealed, setRevealed] = createSignal(false)
  const [status, setStatus] = createSignal<Status | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [showRail, setShowRail] = createSignal(true)
  const [railError, setRailError] = createSignal('')
  const [shortcuts, setShortcuts] = createSignal<Shortcut[]>(fallbackShortcuts)
  const [dark, setDark] = createSignal(false)
  const [version] = createSignal(readVersion())
  const [productName] = createSignal(readProductName())

  onSettled(() => {
    let active = true

    const query = window.matchMedia('(prefers-color-scheme: dark)')
    setDark(query.matches)
    const onSchemeChange = (event: MediaQueryListEvent) => setDark(event.matches)
    query.addEventListener('change', onSchemeChange)

    void (async () => {
      const [storedToken, settings, commands] = await Promise.all([readToken(), readSettings(), readShortcuts().catch(() => fallbackShortcuts)])
      if (!active) return
      setToken(storedToken)
      setShowRail(settings.showRail)
      setShortcuts(commands)
      setStatus({
        tone: 'muted',
        text: storedToken ? 'A token is saved on this device.' : 'No token saved. Anonymous requests are limited to 60 an hour.',
      })
    })()

    return () => {
      active = false
      query.removeEventListener('change', onSchemeChange)
    }
  })

  async function handleSave(): Promise<void> {
    const value = token().trim()
    if (!value) {
      setStatus({ tone: 'error', text: 'Paste a token first.' })
      return
    }
    setBusy(true)
    setStatus({ tone: 'muted', text: 'Saving…' })
    try {
      await saveToken(value)
      setToken(value)
      setStatus({ tone: 'muted', text: 'Saved. Checking the token with GitHub…' })
      const result = await checkToken(value)
      setStatus({
        tone: result.ok ? 'ok' : 'error',
        text: result.ok ? result.message : `Saved. ${result.message}`,
      })
    } catch {
      setStatus({ tone: 'error', text: 'Could not save the token on this device.' })
    } finally {
      setBusy(false)
    }
  }

  async function handleClear(): Promise<void> {
    setBusy(true)
    try {
      await clearToken()
      setToken('')
      setRevealed(false)
      setStatus({ tone: 'muted', text: 'Token cleared. Requests are anonymous again.' })
    } catch {
      setStatus({ tone: 'error', text: 'Could not clear the saved token.' })
    } finally {
      setBusy(false)
    }
  }

  async function toggleRail(): Promise<void> {
    const next = !showRail()
    setShowRail(next)
    setRailError('')
    try {
      await saveShowRail(next)
    } catch {
      setShowRail(!next)
      setRailError('Could not save this setting. Try again.')
    }
  }

  return (
    <div class={cx(styles.page, dark() && darkStyles)} style={`color-scheme:${dark() ? 'dark' : 'light'}`}>
      <div class={cx(styles.shell)}>
        <header class={cx(styles.header)}>
          <div class={cx(styles.mark)} aria-hidden='true'>
            ⇄
          </div>
          <div class={cx(styles.brand)}>
            <h1 class={cx(styles.brandTitle)}>{productName()}</h1>
            <p class={cx(styles.brandSubtitle)}>Settings</p>
          </div>
          <span class={cx(styles.version)}>v{version()}</span>
        </header>

        <main class={cx(styles.main)}>
          <section class={cx(styles.card)} aria-labelledby='github-access-title'>
            <div class={cx(styles.cardHeader)}>
              <div class={cx(styles.cardIcon)}>
                <KeyIcon />
              </div>
              <div class={cx(styles.cardHeading)}>
                <h2 id='github-access-title' class={cx(styles.cardTitle)}>
                  GitHub access
                </h2>
                <p class={cx(styles.cardDescription)}>Optional. Raises the GitHub API limit from 60 to 5,000 requests an hour and opens private repositories for the dependency bridge.</p>
              </div>
            </div>

            <form
              class={cx(styles.cardBody)}
              onSubmit={(event) => {
                event.preventDefault()
                void handleSave()
              }}
            >
              <div>
                <span id='token-label' class={cx(styles.label)}>
                  Fine-grained or classic token
                </span>
                <div class={cx(styles.field)}>
                  <div class={cx(styles.inputWrap)}>
                    <input id='token' class={cx(styles.input)} type={revealed() ? 'text' : 'password'} value={token()} autocomplete='off' spellcheck={false} aria-labelledby='token-label' placeholder='github_pat_… or ghp_…' onInput={(event) => setToken(event.currentTarget.value)} />
                    <button type='button' class={cx(styles.reveal)} aria-pressed={revealed() ? 'true' : 'false'} onClick={() => setRevealed((value) => !value)}>
                      {revealed() ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>

              <div class={cx(styles.actions)}>
                <button id='save' type='submit' class={cx(styles.button, styles.primary)} disabled={busy()}>
                  {busy() ? 'Checking…' : 'Save token'}
                </button>
                <button id='clear' type='button' class={cx(styles.button, styles.danger)} disabled={busy()} onClick={() => void handleClear()}>
                  Clear
                </button>
              </div>

              <output id='status' class={cx(styles.status, status()?.tone === 'ok' && styles.statusOkText, status()?.tone === 'error' && styles.statusErrorText)} aria-live='polite'>
                <span class={cx(styles.statusDot, status()?.tone === 'ok' && styles.statusOk, status()?.tone === 'error' && styles.statusError)} />
                <span>{status()?.text ?? 'Reading saved settings…'}</span>
              </output>

              <p class={cx(styles.hint)}>
                Stored in <code class={cx(styles.code)}>chrome.storage.local</code> and sent only to <code class={cx(styles.code)}>api.github.com</code> and <code class={cx(styles.code)}>raw.githubusercontent.com</code>. For private repositories, grant <strong>Contents: read</strong> and{' '}
                <strong>Pull requests: read</strong>.
              </p>
            </form>
          </section>

          <section class={cx(styles.card)} aria-labelledby='rail-title'>
            <div class={cx(styles.cardHeader)}>
              <div class={cx(styles.cardIcon)}>
                <RailIcon />
              </div>
              <div class={cx(styles.cardHeading)}>
                <h2 id='rail-title' class={cx(styles.cardTitle)}>
                  On-page rail
                </h2>
                <p class={cx(styles.cardDescription)}>The floating rail appears on supported GitHub, DiffsHub, npm, and npmx pages, and carries the file or line you were reading when you switch.</p>
              </div>
            </div>

            <div class={cx(styles.cardBody)}>
              <div class={cx(styles.toggleRow)}>
                <div class={cx(styles.toggleText)}>
                  <p class={cx(styles.toggleTitle)}>Show the floating rail</p>
                  <p class={cx(styles.toggleDescription)}>Takes effect immediately in open tabs.</p>
                </div>
                <button type='button' role='switch' aria-checked={showRail() ? 'true' : 'false'} aria-label='Show the floating rail' class={cx(styles.switchTrack, showRail() && styles.switchTrackOn)} onClick={() => void toggleRail()}>
                  <span class={cx(styles.switchKnob, showRail() && styles.switchKnobOn)} />
                </button>
              </div>
              <Show when={railError()}>
                <output class={cx(styles.status, styles.statusErrorText)} aria-live='polite'>
                  <span class={cx(styles.statusDot, styles.statusError)} />
                  <span>{railError()}</span>
                </output>
              </Show>
              <p class={cx(styles.hint)}>With the rail hidden, the keyboard shortcuts still work.</p>
            </div>
          </section>

          <section class={cx(styles.card)} aria-labelledby='shortcuts-title'>
            <div class={cx(styles.cardHeader)}>
              <div class={cx(styles.cardIcon)}>
                <KeyboardIcon />
              </div>
              <div class={cx(styles.cardHeading)}>
                <h2 id='shortcuts-title' class={cx(styles.cardTitle)}>
                  Keyboard shortcuts
                </h2>
                <p class={cx(styles.cardDescription)}>Chrome owns these shortcuts, so they keep working even when the rail is hidden.</p>
              </div>
            </div>

            <div class={cx(styles.cardBody)}>
              <div class={cx(styles.list)}>
                <For each={shortcuts()}>
                  {(shortcut) => (
                    <div class={cx(styles.row)}>
                      <span class={cx(styles.rowLabel)}>{shortcutLabel(shortcut)}</span>
                      <kbd class={cx(styles.kbd, !shortcut.shortcut && styles.emptyKbd)}>{shortcut.shortcut || 'Not set'}</kbd>
                    </div>
                  )}
                </For>
              </div>
              <div class={cx(styles.shortcutFooter)}>
                <p class={cx(styles.hint)}>Change them on Chrome's shortcuts page.</p>
                <Show when={canManageShortcuts()}>
                  <button type='button' class={cx(styles.button)} onClick={manageShortcuts}>
                    Manage shortcuts
                  </button>
                </Show>
              </div>
            </div>
          </section>
        </main>

        <footer class={cx(styles.footer)}>
          <span>
            {productName()} {version()}
          </span>
          <span class={cx(styles.footerDot)} />
          <a class={cx(styles.link)} href='https://diffshub.com' target='_blank' rel='noopener noreferrer'>
            DiffsHub
          </a>
          <span class={cx(styles.footerDot)} />
          <a class={cx(styles.link)} href='https://npmx.dev' target='_blank' rel='noopener noreferrer'>
            npmx
          </a>
          <span class={cx(styles.footerDot)} />
          <span>Settings stay on this device.</span>
        </footer>
      </div>
    </div>
  )
}
