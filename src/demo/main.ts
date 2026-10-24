import { parseUrl, parseUrlState } from '../core/parse.ts'
import { alternatesFor } from '../core/switch.ts'

const SAMPLES = [
  'https://github.com/oven-sh/bun/pull/30412/changes',
  'https://diffshub.com/oven-sh/bun/pull/30412#target=.buildkite/ci.mjs&start=A42&end=A50',
  'https://www.npmjs.com/package/@nuxt/kit/v/4.0.0',
  'https://npmx.dev/diff/vue/v/3.5.26...3.5.27',
  'https://npmx.dev/package-code/vue/v/3.5.27/dist/vue.d.ts#L10-L20',
]

const input = document.querySelector<HTMLInputElement>('#url')!
const surfaceList = document.querySelector<HTMLDListElement>('#surface')!
const stateBox = document.querySelector<HTMLElement>('#state')!
const alternatesBox = document.querySelector<HTMLElement>('#alternates')!
const samplesBox = document.querySelector<HTMLElement>('#samples')!

function row(label: string, value: string | undefined): void {
  if (!value) return
  const dt = document.createElement('dt')
  dt.textContent = label
  const dd = document.createElement('dd')
  dd.textContent = value
  surfaceList.append(dt, dd)
}

function render(): void {
  surfaceList.replaceChildren()
  alternatesBox.replaceChildren()
  stateBox.textContent = ''

  const surface = parseUrl(input.value)
  if (!surface) {
    const dt = document.createElement('dt')
    dt.textContent = 'result'
    const dd = document.createElement('dd')
    dd.textContent = 'Not a supported surface (or not a URL).'
    surfaceList.append(dt, dd)
    return
  }

  const state = parseUrlState(surface)
  row('surface', surface.id)
  row('kind', surface.kind)
  row('repo', surface.repo ? `${surface.repo.owner}/${surface.repo.repo}` : undefined)
  row('pull', surface.number)
  row('sha', surface.sha)
  row('range', surface.range)
  row('package', surface.pkg)
  row('version', surface.version)
  row('file', surface.file)
  row('user', surface.user)
  row('org', surface.org)
  row('query', surface.query)

  stateBox.textContent = Object.keys(state).length ? `URL state: ${JSON.stringify(state)}` : 'URL state: (none)'

  for (const alternate of alternatesFor(surface, state)) {
    const card = document.createElement('div')
    card.className = 'alt'
    const head = document.createElement('div')
    head.textContent = `${alternate.label}${alternate.available ? '' : ' — unavailable'}`
    card.append(head)
    if (alternate.url) {
      const link = document.createElement('a')
      link.href = alternate.url
      link.textContent = alternate.url
      link.rel = 'noreferrer'
      card.append(link)
    } else {
      const none = document.createElement('span')
      none.className = 'none'
      none.textContent = alternate.note ?? 'No equivalent view'
      card.append(none)
    }
    alternatesBox.append(card)
  }
}

for (const sample of SAMPLES) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = sample.replace(/^https:\/\//, '').slice(0, 54)
  button.addEventListener('click', () => {
    input.value = sample
    render()
  })
  samplesBox.append(button)
}

input.addEventListener('input', render)
document.querySelector('#go')?.addEventListener('click', render)
input.value = SAMPLES[1]!
render()
