import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageFetcher, parseClaudeUsage, parseChatgptUsage } from '../src/usage.mjs'

const claudeBody = { five_hour: { utilization: 24, resets_at: '2026-01-01T00:00:00Z' }, seven_day: { utilization: 80, resets_at: null }, email: 'secret@example.com' }
const chatgptBody = { rate_limit: { primary_window: { used_percent: 8, limit_window_seconds: 18000, reset_at: 1767225600 }, secondary_window: { used_percent: 65, limit_window_seconds: 604800, reset_at: null } }, account_id: 'account-secret' }
const grant = { kind: 'grant', payload: { type: 'oauth', access: 'token-secret', expires: 9999999, accountId: 'account-secret' } }
function setup(options = {}) {
  const calls = []
  const read = []
  const fetchUsage = createUsageFetcher({
    now: () => 100,
    credentials: { async readRecord(key) { read.push(key); return grant } },
    resolveProvider: route => route,
    fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => url.includes('anthropic') ? claudeBody : chatgptBody } },
    ...options,
  })
  return { fetchUsage, calls, read }
}

test('parsers allowlist data and identify windows by duration', () => {
  assert.deepEqual(parseClaudeUsage(claudeBody), { status: 'ok', fiveHour: { percent: 24, resetsAt: '2026-01-01T00:00:00.000Z' }, weekly: { percent: 80, resetsAt: null } })
  const reversed = { rate_limit: { primary_window: chatgptBody.rate_limit.secondary_window, secondary_window: chatgptBody.rate_limit.primary_window } }
  assert.deepEqual(parseChatgptUsage(reversed), { status: 'ok', fiveHour: { percent: 8, resetsAt: '2026-01-01T00:00:00.000Z' }, weekly: { percent: 65, resetsAt: null } })
  assert.equal(parseClaudeUsage({ five_hour: { utilization: 101 }, seven_day: {} }).status, 'unexpected-format')
  assert.equal(parseChatgptUsage({ rate_limit: { primary_window: chatgptBody.rate_limit.primary_window } }).status, 'unexpected-format')
})

test('fetches only correct endpoints and does not expose credentials or response extras', async () => {
  const { fetchUsage, calls, read } = setup()
  const result = await fetchUsage()
  assert.equal(result.claude.status, 'ok'); assert.equal(result.chatgpt.status, 'ok')
  assert.deepEqual(read.sort(), ['llm-pi-ai/anthropic', 'llm-pi-ai/openai-codex'])
  assert.equal(calls[0].url, 'https://api.anthropic.com/api/oauth/usage')
  assert.equal(calls[1].url, 'https://chatgpt.com/backend-api/wham/usage')
  assert.equal(calls[0].init.headers['anthropic-beta'], 'oauth-2025-04-20')
  assert.equal(calls[1].init.headers['chatgpt-account-id'], 'account-secret')
  for (const call of calls) assert.equal(call.init.redirect, 'error')
  assert.doesNotMatch(JSON.stringify(result), /token-secret|account-secret|secret@example.com/)
})

test('unknown route ownership never reads or sends credentials', async () => {
  const { fetchUsage, calls, read } = setup({ resolveProvider: () => undefined })
  assert.deepEqual(await fetchUsage(), { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } })
  assert.deepEqual(read, []); assert.deepEqual(calls, [])
})

test('custom route requires a matching catalog tag', async () => {
  const { fetchUsage, calls, read } = setup({
    resolveProvider: route => route === 'anthropic' ? 'custom-claude' : 'custom-codex',
    credentials: { async readRecord(key) { read.push(key); return { ...grant, payload: { ...grant.payload, dsh: { catalog: key === 'llm-pi-ai/custom-claude' ? 'anthropic' : 'openai-codex' } } } } },
  })
  assert.equal((await fetchUsage()).claude.status, 'ok')
  assert.deepEqual(read.sort(), ['llm-pi-ai/custom-claude', 'llm-pi-ai/custom-codex'])
  assert.equal(calls.length, 2)
  const missing = setup({ resolveProvider: () => 'custom', credentials: { readRecord: async () => grant } })
  assert.equal((await missing.fetchUsage()).claude.status, 'unavailable')
  assert.equal(missing.calls.length, 0)
})

test('rejects grant tagged for another catalog even on an owned route', async () => {
  const { fetchUsage, calls } = setup({ credentials: { readRecord: async () => ({ ...grant, payload: { ...grant.payload, dsh: { catalog: 'another-provider' } } }) } })
  assert.deepEqual(await fetchUsage(), { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } })
  assert.deepEqual(calls, [])
})

test('absent, expired, invalid grants and request failures are sanitized', async () => {
  for (const [record, status] of [[undefined, 'not-signed-in'], [{ kind: 'api-key' }, 'not-signed-in'], [{ ...grant, payload: { ...grant.payload, expires: 1 } }, 'token-expired'], [{ ...grant, payload: { ...grant.payload, accountId: '' } }, 'unavailable']]) {
    const result = await setup({ credentials: { readRecord: async () => record } }).fetchUsage()
    assert.equal(result.chatgpt.status, status)
  }
  for (const [response, status] of [[{ status: 401 }, 'token-expired'], [{ status: 503 }, 'unavailable'], [{ status: 200, ok: true, json: async () => { throw Error('token-secret') } }, 'unexpected-format']]) {
    const result = await setup({ fetch: async () => response }).fetchUsage()
    assert.equal(result.claude.status, status); assert.equal(result.chatgpt.status, status)
    assert.doesNotMatch(JSON.stringify(result), /token-secret/)
  }
  assert.equal((await setup({ credentials: { readRecord: async () => { throw Error('token-secret') } } }).fetchUsage()).claude.status, 'unavailable')
})

test('deadlines cover lookup and prevent work after late resolution', async () => {
  for (const stage of ['route', 'credential']) {
    const releases = []
    let reads = 0
    let requests = 0
    const pending = () => new Promise(resolve => releases.push(resolve))
    const { fetchUsage } = setup({
      timeoutMs: 10,
      resolveProvider: route => stage === 'route' ? pending() : route,
      credentials: { readRecord: () => { reads++; return pending() } },
      fetch: async () => { requests++; throw Error('unexpected request') },
    })
    assert.deepEqual(await fetchUsage(), { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } })
    for (const [index, release] of releases.entries()) release(stage === 'route' ? ['anthropic', 'openai-codex'][index] : grant)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(requests, 0)
    assert.equal(reads, stage === 'route' ? 0 : 2)
  }
})

test('abort rejection after timeout is handled without an unhandled rejection', async () => {
  const { fetchUsage } = setup({
    timeoutMs: 10,
    fetch: (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => setImmediate(() => reject(new Error('aborted'))), { once: true })
    }),
  })
  assert.deepEqual(await fetchUsage(), { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } })
  await new Promise(resolve => setImmediate(resolve))
})

test('coalesces concurrent calls and times out hung requests', async () => {
  let count = 0
  const { fetchUsage } = setup({ timeoutMs: 10, fetch: async () => { count++; return new Promise(() => {}) } })
  const a = fetchUsage(); const b = fetchUsage()
  assert.equal(a, b)
  assert.deepEqual(await a, { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } })
  assert.equal(count, 2)
})
