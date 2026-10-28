export interface RailAction {
  label: string
  onClick: () => void
  title?: string
}

export interface RailOptions {
  currentLabel: string
  actions: RailAction[]
  bridge?: RailAction
  back?: RailAction
}

export interface RailHandle {
  host: HTMLElement
  openPanel(title: string, body: HTMLElement): void
  closePanel(): void
  isPanelOpen(): boolean
  /** Add the "back" chip after the rail is already on screen (at most once) */
  setBack(action: RailAction): void
  destroy(): void
}

const CSS = `
:host {
  all: initial;
  position: fixed;
  inset-inline-end: 16px;
  bottom: 16px;
  z-index: 2147483647;
  --bg: rgba(24, 24, 27, 0.94);
  --fg: #f4f4f5;
  --muted: #a1a1aa;
  --line: rgba(255, 255, 255, 0.12);
  --hover: rgba(255, 255, 255, 0.07);
  --accent: #86efac;
  --accent-bg: rgba(134, 239, 172, 0.14);
  --shadow: 0 12px 32px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.08);
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :host {
    --bg: rgba(255, 255, 255, 0.96);
    --fg: #18181b;
    --muted: #52525b;
    --line: rgba(0, 0, 0, 0.1);
    --hover: rgba(0, 0, 0, 0.05);
    --accent: #15803d;
    --accent-bg: rgba(21, 128, 61, 0.12);
    --shadow: 0 12px 32px rgba(0, 0, 0, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.08);
    color-scheme: light;
  }
}
.wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  font-family: var(--sans);
  font-size: 12px;
  line-height: 1.4;
  color: var(--fg);
  pointer-events: none;
}
.rail, .panel { pointer-events: auto; }
.rail {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  background: var(--bg);
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  white-space: nowrap;
}
.chip {
  appearance: none;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 6px 10px;
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.chip:hover { background: var(--hover); }
.chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.chip.current { font-weight: 600; background: var(--hover); cursor: default; }
.chip.bridge { color: var(--accent); background: var(--accent-bg); font-weight: 600; }
.chip.bridge:hover { filter: brightness(1.1); }
.chip.back { color: var(--muted); }
.sep { width: 1px; height: 16px; background: var(--line); margin: 0 2px; }
.panel {
  width: min(92vw, 390px);
  max-height: min(64vh, 560px);
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  background: var(--bg);
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  overflow: hidden;
}
.panel[hidden] { display: none; }
.panel header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  font-weight: 600;
  font-size: 12.5px;
}
.panel header .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.panel header .x {
  appearance: none; border: 0; background: transparent; color: var(--muted);
  font: 16px/1 var(--sans); padding: 2px 4px; cursor: pointer; border-radius: 6px;
}
.panel header .x:hover { background: var(--hover); color: var(--fg); }
.body { overflow: auto; padding: 6px; }
.stack { display: flex; flex-direction: column; gap: 6px; }
.meta { color: var(--muted); font-size: 11px; padding: 2px 8px 6px; }
.list { display: flex; flex-direction: column; gap: 1px; }
.dep {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 2px 8px;
  padding: 7px 8px;
  border-radius: 8px;
}
.dep:hover { background: var(--hover); }
.name {
  font-family: var(--mono);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ver { color: var(--muted); font-family: var(--mono); font-size: 11px; }
.dep-actions { grid-row: 1 / span 2; grid-column: 2; display: flex; align-items: center; gap: 4px; }
.badge {
  font-size: 10px;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--hover);
  color: var(--muted);
  white-space: nowrap;
}
.badge.major { color: #fca5a5; background: rgba(248, 113, 113, 0.14); }
@media (prefers-color-scheme: light) {
  .badge.major { color: #b91c1c; background: rgba(185, 28, 28, 0.1); }
}
.btn {
  appearance: none;
  border: 0;
  border-radius: 6px;
  background: var(--accent-bg);
  color: var(--accent);
  font: 600 11px var(--sans);
  padding: 4px 8px;
  cursor: pointer;
  white-space: nowrap;
}
.btn:hover { filter: brightness(1.12); }
.btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.iconbtn {
  appearance: none; border: 0; background: transparent; color: var(--muted);
  font: 12px var(--mono); padding: 3px 5px; cursor: pointer; border-radius: 5px;
  text-decoration: none;
}
.iconbtn:hover { background: var(--hover); color: var(--fg); }
.section-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 8px 8px 4px;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
  flex-wrap: wrap;
}
.empty { padding: 14px 10px; color: var(--muted); }
.error { padding: 12px 10px; color: #fca5a5; }
@media (prefers-color-scheme: light) { .error { color: #b91c1c; } }
.source { display: flex; flex-direction: column; gap: 6px; padding: 4px 2px 8px; }
.source .kicker { color: var(--muted); font-size: 11px; }
.source .target { font-family: var(--mono); font-size: 12px; word-break: break-all; }
.row { display: flex; align-items: center; gap: 6px; }
.spacer { flex: 1; }
`

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

export function mountRail(options: RailOptions): RailHandle {
  const host = document.createElement('better-site-rail')
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = CSS
  shadow.append(style)

  const wrap = el('div', 'wrap')
  const panel = el('section', 'panel')
  panel.hidden = true
  const header = el('header')
  const title = el('span', 'title')
  const close = el('button', 'x', '×') as HTMLButtonElement
  close.type = 'button'
  close.setAttribute('aria-label', 'Close panel')
  header.append(title, close)
  const body = el('div', 'body')
  panel.append(header, body)

  const rail = el('div', 'rail')
  rail.setAttribute('role', 'toolbar')
  rail.setAttribute('aria-label', 'Better Site')

  const chip = (action: RailAction, variant?: string): HTMLButtonElement => {
    const button = el('button', variant ? `chip ${variant}` : 'chip', action.label) as HTMLButtonElement
    button.type = 'button'
    if (action.title) button.title = action.title
    button.addEventListener('click', action.onClick)
    return button
  }

  const current = el('span', 'chip current', options.currentLabel)
  rail.append(current)

  for (const action of options.actions) {
    rail.append(chip(action))
  }

  if (options.bridge) {
    rail.append(el('span', 'sep'))
    rail.append(chip(options.bridge, 'bridge'))
  }

  let backAttached = false
  const setBack = (action: RailAction): void => {
    if (backAttached) return
    backAttached = true
    rail.append(chip({ ...action, title: action.title ?? 'Go back to the previous surface' }, 'back'))
  }

  if (options.back) setBack(options.back)

  wrap.append(panel, rail)
  shadow.append(wrap)
  document.documentElement.append(host)

  let panelOpen = false

  const openPanel = (heading: string, content: HTMLElement): void => {
    title.textContent = heading
    body.replaceChildren(content)
    panel.hidden = false
    panelOpen = true
  }

  const closePanel = (): void => {
    panel.hidden = true
    panelOpen = false
    body.replaceChildren()
  }

  close.addEventListener('click', closePanel)

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && panelOpen) {
      closePanel()
      event.stopPropagation()
    }
  }
  const onPointerDown = (event: PointerEvent): void => {
    if (!panelOpen) return
    if (!event.composedPath().includes(host)) closePanel()
  }
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('pointerdown', onPointerDown, true)

  return {
    host,
    openPanel,
    closePanel,
    isPanelOpen: () => panelOpen,
    setBack,
    destroy: () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      host.remove()
    },
  }
}

export function buildStack(children: HTMLElement[]): HTMLElement {
  const stack = el('div', 'stack')
  stack.append(...children)
  return stack
}

export function buildMeta(text: string): HTMLElement {
  return el('div', 'meta', text)
}

export function buildEmpty(text: string): HTMLElement {
  return el('div', 'empty', text)
}

export function buildError(text: string): HTMLElement {
  return el('div', 'error', text)
}

export function buildSpinner(text: string): HTMLElement {
  return el('div', 'empty', text)
}
