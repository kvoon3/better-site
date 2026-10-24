export interface ExtensionSettings {
  showRail: boolean
}

export const defaultSettings: ExtensionSettings = {
  showRail: true,
}

const TOKEN_KEY = 'githubToken'
const SHOW_RAIL_KEY = 'showRail'
const FALLBACK_PREFIX = 'better-site:'

function extensionStorage(): chrome.storage.StorageArea | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return null
  return chrome.storage.local
}

function readFallback(): Record<string, unknown> {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(`${FALLBACK_PREFIX}settings`) ?? '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeFallback(values: Record<string, unknown>): void {
  if (typeof localStorage === 'undefined') return
  const next = { ...readFallback(), ...values }
  localStorage.setItem(`${FALLBACK_PREFIX}settings`, JSON.stringify(next))
}

async function storageGet(keys: string[]): Promise<Record<string, unknown>> {
  const storage = extensionStorage()
  if (storage) return storage.get(keys)
  return readFallback()
}

async function storageSet(values: Record<string, unknown>): Promise<void> {
  const storage = extensionStorage()
  if (storage) {
    await storage.set(values)
    return
  }
  writeFallback(values)
}

function removeFallback(key: string): void {
  if (typeof localStorage === 'undefined') return
  const next = readFallback()
  delete next[key]
  localStorage.setItem(`${FALLBACK_PREFIX}settings`, JSON.stringify(next))
}

async function storageRemove(key: string): Promise<void> {
  const storage = extensionStorage()
  if (storage) {
    await storage.remove(key)
    return
  }
  removeFallback(key)
}

export async function readSettings(): Promise<ExtensionSettings> {
  try {
    const stored = await storageGet([SHOW_RAIL_KEY])
    return { showRail: stored[SHOW_RAIL_KEY] !== false }
  } catch {
    return { ...defaultSettings }
  }
}

export async function saveShowRail(showRail: boolean): Promise<void> {
  await storageSet({ [SHOW_RAIL_KEY]: showRail })
}

export async function readToken(): Promise<string> {
  try {
    const stored = await storageGet([TOKEN_KEY])
    const token = stored[TOKEN_KEY]
    return typeof token === 'string' ? token : ''
  } catch {
    return ''
  }
}

export async function saveToken(token: string): Promise<void> {
  await storageSet({ [TOKEN_KEY]: token })
}

export async function clearToken(): Promise<void> {
  await storageRemove(TOKEN_KEY)
}

export interface TokenCheck {
  ok: boolean
  message: string
}

interface RateLimitResponse {
  resources?: {
    core?: {
      limit?: number
      remaining?: number
    }
  }
}

export async function checkToken(token: string): Promise<TokenCheck> {
  try {
    const response = await fetch('https://api.github.com/rate_limit', {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (response.status === 401) {
      return { ok: false, message: 'GitHub rejected this token. Check that it was copied whole.' }
    }
    if (!response.ok) {
      return { ok: false, message: `GitHub returned ${response.status}. Try again in a moment.` }
    }
    const data = (await response.json()) as RateLimitResponse
    const core = data.resources?.core
    if (typeof core?.remaining === 'number' && typeof core?.limit === 'number') {
      return {
        ok: true,
        message: `Token works. ${core.remaining.toLocaleString()} of ${core.limit.toLocaleString()} API requests left this hour.`,
      }
    }
    return { ok: true, message: 'Token works.' }
  } catch {
    return { ok: false, message: 'Could not reach api.github.com. Check your connection.' }
  }
}
