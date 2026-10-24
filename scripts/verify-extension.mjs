// End-to-end smoke test: launch Chrome for Testing with the unpacked extension,
// drive a page over CDP, and verify the rail + bridge on real URLs
//
// Usage: CHROME_PATH="/path/to/Google Chrome for Testing" node scripts/verify-extension.mjs
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const extension = resolve(root, 'dist')
function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean)
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  const agentBrowser = `${homedir()}/.agent-browser/browsers`
  if (existsSync(agentBrowser)) {
    for (const entry of readdirSync(agentBrowser)) {
      const candidate = `${agentBrowser}/${entry}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
      if (existsSync(candidate)) return candidate
    }
  }
  // Branded Chrome may reject --load-extension since Chrome 137, so keep it last
  const branded = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(branded)) return branded
  throw new Error('Set CHROME_PATH to a Chrome for Testing or Chromium binary.')
}

const chrome = findChrome()
console.log(`Chrome: ${chrome}`)
const port = 9411
const githubPr = process.env.PR_URL ?? 'https://github.com/vuejs/core/pull/15944'

const profile = await mkdtemp(resolve(tmpdir(), 'better-site-'))
const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore'] })

const failures = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

async function waitFor(label, fn, timeout = 15000, interval = 300) {
  const started = Date.now()
  let lastError
  while (Date.now() - started < timeout) {
    try {
      if (await fn()) return true
    } catch (error) {
      lastError = error
    }
    await new Promise((r) => setTimeout(r, interval))
  }
  if (lastError) console.log(`  (${label}: ${lastError.message})`)
  return false
}

let ws
let nextId = 1
const pending = new Map()

function send(method, params = {}) {
  const id = nextId++
  return new Promise((resolvePromise, reject) => {
    pending.set(id, { resolve: resolvePromise, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? 'evaluate failed')
  }
  return result.result?.value
}

const railExpr = `(() => {
  const host = document.querySelector('better-site-rail');
  return host?.shadowRoot?.textContent?.replace(/\\s+/g, ' ').trim() ?? null;
})()`

const chipsExpr = `(() => {
  const host = document.querySelector('better-site-rail');
  if (!host) return null;
  return [...host.shadowRoot.querySelectorAll('.rail .chip')].map(
    (b) => (b.classList.contains('current') ? '*' + b.textContent.trim() : b.textContent.trim()),
  );
})()`

const clickExpr = (label) => `(() => {
  const host = document.querySelector('better-site-rail');
  if (!host) return 'no rail';
  const buttons = [...host.shadowRoot.querySelectorAll('button.chip')];
  const button = buttons.find((b) => b.textContent.trim() === ${JSON.stringify(label)});
  if (!button) return 'missing: ' + buttons.map((b) => b.textContent.trim()).join(' | ');
  button.click();
  return 'clicked';
})()`

const panelExpr = `(() => {
  const host = document.querySelector('better-site-rail');
  const panel = host?.shadowRoot?.querySelector('.panel');
  if (!panel || panel.hidden) return null;
  return panel.textContent.replace(/\\s+/g, ' ').trim().slice(0, 500);
})()`

async function navigate(url) {
  await send('Page.navigate', { url })
  await waitFor(
    'load',
    async () => {
      const ready = await evaluate('document.readyState')
      return ready === 'complete' || ready === 'interactive'
    },
    20000,
  )
}

async function waitHost(host, timeout = 20000) {
  return waitFor(
    `host ${host}`,
    async () => {
      const current = await evaluate('location.hostname')
      return current === host
    },
    timeout,
  )
}

try {
  await waitFor(
    'devtools',
    async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      return response.ok
    },
    15000,
  )

  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true })
    ws.addEventListener('error', rejectOpen, { once: true })
  })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePromise, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolvePromise(message.result)
    }
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')

  let extensionId = ''
  const extensionReady = await waitFor(
    'extension id',
    async () => {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const worker = targets.find((entry) => entry.type === 'service_worker' && /^chrome-extension:\/\/[a-p]{32}\/background\.js$/.test(entry.url))
      if (!worker) return false
      extensionId = new URL(worker.url).hostname
      return true
    },
    20000,
  )
  if (!extensionReady) throw new Error('The extension service worker did not start.')

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })

  // 1. GitHub PR -> rail
  await navigate(githubPr)
  const railReady = await waitFor('rail', async () => (await evaluate(railExpr)) != null)
  check('GitHub PR mounts the rail', railReady, String(await evaluate(railExpr)))
  const chips = await evaluate(chipsExpr)
  check('GitHub rail offers DiffsHub', JSON.stringify(chips ?? []).includes('DiffsHub'), JSON.stringify(chips))

  // 2. Dependency bridge on GitHub (uses the page's embedded refs if the API
  // budget is exhausted)
  await evaluate(clickExpr('Deps'))
  const panel = (await waitFor(
    'deps panel',
    async () => {
      const text = await evaluate(panelExpr)
      return text && !text.includes('Reading dependency changes')
    },
    30000,
  ))
    ? await evaluate(panelExpr)
    : await evaluate(panelExpr)
  check('Dependency panel resolves', panel != null && !String(panel).includes('Reading') && !String(panel).includes('rate limit'), String(panel).slice(0, 220))

  if (process.env.SHOT) {
    await evaluate('window.scrollTo(0, 0)')
    const shot = await send('Page.captureScreenshot', { format: 'png' })
    await mkdir(resolve(root, 'docs'), { recursive: true })
    await writeFile(resolve(root, 'docs/rail.png'), Buffer.from(shot.data, 'base64'))
    console.log('SHOT  docs/rail.png')
  }

  // 3. Switch to DiffsHub
  await evaluate(clickExpr('DiffsHub'))
  const switched = await waitHost('diffshub.com')
  check('Rail switches GitHub -> DiffsHub', switched, await evaluate('location.href'))
  const diffsChips = (await waitFor('diffs rail', async () => (await evaluate(chipsExpr)) != null)) ? await evaluate(chipsExpr) : null
  check('DiffsHub rail offers GitHub', JSON.stringify(diffsChips ?? []).includes('GitHub'), JSON.stringify(diffsChips))

  // 4. Switch npm -> npmx
  await navigate('https://www.npmjs.com/package/vue/v/3.5.27')
  const npmRail = await waitFor('npm rail', async () => (await evaluate(chipsExpr)) != null)
  check('npmjs version page mounts the rail', npmRail, JSON.stringify(await evaluate(chipsExpr)))
  await evaluate(clickExpr('npmx'))
  const npmxSwitched = await waitHost('npmx.dev')
  check('Rail switches npm -> npmx', npmxSwitched, await evaluate('location.href'))

  // 5. Source bridge on an npmx version diff
  await navigate('https://npmx.dev/diff/vue/v/3.5.26...3.5.27')
  const diffRail = await waitFor('npmx rail', async () => (await evaluate(chipsExpr)) != null)
  check('npmx diff mounts the rail', diffRail, JSON.stringify(await evaluate(chipsExpr)))
  await evaluate(clickExpr('Source'))
  const sourcePanel = (await waitFor(
    'source panel',
    async () => {
      const text = await evaluate(panelExpr)
      return text && !text.includes('Resolving source')
    },
    30000,
  ))
    ? await evaluate(panelExpr)
    : await evaluate(panelExpr)
  check('Source panel resolves', sourcePanel != null && !String(sourcePanel).includes('Resolving'), String(sourcePanel).slice(0, 180))

  // 6. Anchor round-trip: GitHub #diff-<sha256(path)>R12 -> DiffsHub -> GitHub
  const anchorPr = 'https://github.com/npmx-dev/npmx.dev/pull/3193/files'
  const anchorFile = 'knip.ts'
  const anchorHash = createHash('sha256').update(anchorFile).digest('hex')
  await navigate(`${anchorPr}#diff-${anchorHash}R12`)
  const anchorRail = await waitFor('anchor rail', async () => (await evaluate(chipsExpr)) != null)
  if (anchorRail) {
    await evaluate(clickExpr('DiffsHub'))
    await waitHost('diffshub.com')
    await waitFor('diffs rail', async () => (await evaluate(chipsExpr)) != null)
    const diffsFull = await evaluate('location.href')
    check('GitHub line anchor reaches DiffsHub', String(diffsFull).includes('target=knip.ts') && String(diffsFull).includes('start=A12'), String(diffsFull))

    await evaluate(clickExpr('GitHub'))
    const toGithub = await waitHost('github.com')
    await new Promise((r) => setTimeout(r, 1500))
    const githubFull = toGithub ? await evaluate('location.href') : ''
    check('DiffsHub line anchor returns to GitHub', String(githubFull).includes(`diff-${anchorHash}`) && String(githubFull).includes('R12'), String(githubFull))
  } else {
    check('GitHub line anchor reaches DiffsHub', false, 'rail did not mount')
  }

  // 7. Options page: save + clear a token in chrome.storage.local
  const ids = [extensionId]
  let optionsOk = false
  for (const id of ids) {
    await send('Page.navigate', { url: `chrome-extension://${id}/options.html` })
    const found = await waitFor(
      'options',
      async () => {
        const ready = await evaluate('document.readyState')
        return ready === 'complete' && (await evaluate(`!!document.querySelector('#token')`)) === true
      },
      5000,
    )
    if (!found) continue
    await evaluate(`document.querySelector('#token').focus()`)
    await send('Input.insertText', { text: 'ghp_verify_only' })
    await evaluate(`document.querySelector('#save').click()`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
    const saved = await waitFor(
      'token saved',
      async () => {
        const stored = await evaluate(`chrome.storage.local.get('githubToken')`)
        return stored?.githubToken === 'ghp_verify_only'
      },
      3000,
    )
    await evaluate(`chrome.storage.local.remove('githubToken')`)
    optionsOk = saved
    break
  }
  check('Options page saves a token', optionsOk)

  // 8. Settings page: the rail switch persists
  await send('Page.navigate', { url: `chrome-extension://${extensionId}/options.html` })
  const switchFound = await waitFor('settings switch', async () => (await evaluate(`!!document.querySelector('[role="switch"]')`)) === true, 5000)
  let railSwitchOk = false
  if (switchFound) {
    await evaluate(`document.querySelector('[role="switch"]').click()`)
    const off = await waitFor('rail off saved', async () => (await evaluate(`chrome.storage.local.get('showRail')`))?.showRail === false, 3000)
    await evaluate(`document.querySelector('[role="switch"]').click()`)
    const on = await waitFor('rail on saved', async () => (await evaluate(`chrome.storage.local.get('showRail')`))?.showRail === true, 3000)
    railSwitchOk = off && on
  }
  check('Settings page persists the rail switch', railSwitchOk)
  const brand = await evaluate(`document.querySelector('h1')?.textContent`)
  check('Settings page shows the product name', brand === 'Better Site', String(brand))
} catch (error) {
  console.error('VERIFY ERROR:', error)
  failures.push('harness')
} finally {
  ws?.close()
  browser.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  await rm(profile, { recursive: true, force: true }).catch(() => {})
  console.log(`\n${failures.length ? `${failures.length} failure(s)` : 'All checks passed'}`)
  process.exit(failures.length ? 1 : 0)
}
