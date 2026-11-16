const PROVIDERS = {
  claude: { route: 'anthropic', url: 'https://api.anthropic.com/api/oauth/usage' },
  chatgpt: { route: 'openai-codex', url: 'https://chatgpt.com/backend-api/wham/usage' },
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
  if (reset !== null && reset !== undefined && (typeof reset !== 'number' || !Number.isFinite(reset))) return null
  const date = reset == null ? null : new Date(reset * 1000)
  if (date && !Number.isFinite(date.getTime())) return null
  return windowValue(value.used_percent, date ? date.toISOString() : null)
}

export function parseClaudeUsage(data) {
  const fiveHour = claudeWindow(data?.five_hour)
  const weekly = claudeWindow(data?.seven_day)
  return fiveHour && weekly ? { status: 'ok', fiveHour, weekly } : { status: 'unexpected-format' }
}

export function parseChatgptUsage(data) {
  const windows = [data?.rate_limit?.primary_window, data?.rate_limit?.secondary_window]
  const five = windows.filter(value => value?.limit_window_seconds === 18000)
  const week = windows.filter(value => value?.limit_window_seconds === 604800)
  if (five.length !== 1 || week.length !== 1) return { status: 'unexpected-format' }
  const fiveHour = codexWindow(five[0])
  const weekly = codexWindow(week[0])
  return fiveHour && weekly ? { status: 'ok', fiveHour, weekly } : { status: 'unexpected-format' }
}

// resolveProvider must independently identify the live catalog provider for this route.
export function createUsageFetcher({ credentials, fetch, resolveProvider, now = Date.now, timeoutMs = 10000 }) {
  let inFlight
  async function getUsage(name) {
    const { route, url } = PROVIDERS[name]
    const controller = new AbortController()
    let timer
    try {
      const timeout = new Promise(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve({ status: 'unavailable' }) }, timeoutMs)
      })
      const request = (async () => {
        const selectedRoute = await resolveProvider(route)
        if (typeof selectedRoute !== 'string' || !selectedRoute || controller.signal.aborted) return { status: 'unavailable' }
        const record = await credentials.readRecord(`llm-pi-ai/${selectedRoute}`)
        if (controller.signal.aborted) return { status: 'unavailable' }
        if (!record || record.kind !== 'grant' || record.payload?.type !== 'oauth') return { status: 'not-signed-in' }
        const grant = record.payload
        if (grant.dsh?.catalog !== route && !(selectedRoute === route && grant.dsh === undefined)) return { status: 'unavailable' }
        if (typeof grant.access !== 'string' || !grant.access || typeof grant.expires !== 'number' || !Number.isFinite(grant.expires)) return { status: 'unavailable' }
        if (grant.expires <= now()) return { status: 'token-expired' }
        if (name === 'chatgpt' && (typeof grant.accountId !== 'string' || !grant.accountId)) return { status: 'unavailable' }
        const headers = { Authorization: `Bearer ${grant.access}` }
        if (name === 'claude') headers['anthropic-beta'] = 'oauth-2025-04-20'
        else headers['chatgpt-account-id'] = grant.accountId
        const response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: controller.signal })
        if (response.status === 401) return { status: 'token-expired' }
        if (!response.ok) return { status: 'unavailable' }
        let body
        try { body = await response.json() } catch { return { status: 'unexpected-format' } }
        return name === 'claude' ? parseClaudeUsage(body) : parseChatgptUsage(body)
      })()
      return await Promise.race([request, timeout])
    } catch { return { status: 'unavailable' } } finally { clearTimeout(timer) }
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
