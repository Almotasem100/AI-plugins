const PROVIDERS = {
  claude: 'https://api.anthropic.com/api/oauth/usage',
  chatgpt: 'https://chatgpt.com/backend-api/wham/usage',
}

function windowValue(percent, reset) {
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return null
  if (reset !== null && (typeof reset !== 'string' || !Number.isFinite(Date.parse(reset)))) return null
  return { percent, resetsAt: reset === null ? null : new Date(reset).toISOString() }
}

function claudeWindow(value) {
  if (!value || typeof value !== 'object') return null
  return windowValue(value.utilization, value.resets_at ?? null)
}

function codexWindow(value) {
  if (!value || typeof value !== 'object') return null
  const reset = value.reset_at
  if (reset != null && (typeof reset !== 'number' || !Number.isFinite(reset))) return null
  const date = reset == null ? null : new Date(reset * 1000)
  if (date && !Number.isFinite(date.getTime())) return null
  return windowValue(value.used_percent, date ? date.toISOString() : null)
}

export function parseClaudeUsage(data) {
  const fiveHour = claudeWindow(data?.five_hour)
  const weekly = claudeWindow(data?.seven_day)
  return fiveHour || weekly ? { status: 'ok', ...(fiveHour && { fiveHour }), ...(weekly && { weekly }) } : { status: 'unexpected-format' }
}

export function parseChatgptUsage(data) {
  const windows = [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window]
  const five = windows.filter(value => value?.limit_window_seconds === 18000)
  const week = windows.filter(value => value?.limit_window_seconds === 604800)
  const fiveHour = five.length === 1 ? codexWindow(five[0]) : null
  const weekly = week.length === 1 ? codexWindow(week[0]) : null
  return fiveHour || weekly ? { status: 'ok', ...(fiveHour && { fiveHour }), ...(weekly && { weekly }) } : { status: 'unexpected-format' }
}

// Credentials are host-provided { access, expires, accountId? }; expires is epoch milliseconds.
export function createUsageFetcher({ resolveCredential, fetch, now = Date.now, timeoutMs = 10000 }) {
  let inFlight
  async function getUsage(name) {
    const controller = new AbortController()
    let timer
    try {
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve({ status: 'unavailable' }) }, timeoutMs)
      })
      const request = (async () => {
        const credential = await resolveCredential(name)
        if (controller.signal.aborted) return { status: 'unavailable' }
        if (credential === undefined) return { status: 'not-signed-in' }
        if (!credential || typeof credential.access !== 'string' || !/^[\x21-\x7e]+$/.test(credential.access) ||
            typeof credential.expires !== 'number' || !Number.isFinite(new Date(credential.expires).getTime())) return { status: 'unavailable' }
        // OpenCode uses zero when the issuer did not provide a token lifetime.
        if (credential.expires !== 0 && credential.expires <= now()) return { status: 'token-expired' }
        if (name === 'chatgpt' && (typeof credential.accountId !== 'string' || !/^[\x21-\x7e]+$/.test(credential.accountId))) return { status: 'unavailable' }
        const headers = { Authorization: `Bearer ${credential.access}` }
        if (name === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20'
        else headers['chatgpt-account-id'] = credential.accountId
        const response = await fetch(PROVIDERS[name], { method: 'GET', headers, redirect: 'error', signal: controller.signal })
        if (response.status === 401) return { status: 'token-expired' }
        if (!response.ok) return { status: 'unavailable' }
        let body
        try { body = await response.json() } catch { return { status: 'unexpected-format' } }
        return name === 'claude' ? parseClaudeUsage(body) : parseChatgptUsage(body)
      })()
      return await Promise.race([request, timeout])
    } catch {
      return { status: 'unavailable' }
    } finally {
      clearTimeout(timer)
    }
  }
  return function fetchUsage() {
    if (!inFlight) {
      inFlight = Promise.all([getUsage('claude'), getUsage('chatgpt')])
        .then(([claude, chatgpt]) => ({ claude, chatgpt }))
        .finally(() => { inFlight = undefined })
    }
    return inFlight
  }
}
