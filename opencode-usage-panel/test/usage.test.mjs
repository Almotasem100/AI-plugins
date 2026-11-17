import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageFetcher, parseClaudeUsage, parseChatgptUsage } from '../src/usage.mjs'

const claude = { five_hour: { utilization: 25, resets_at: '2025-01-01T01:00:00+01:00' }, seven_day: { utilization: 80 } }
const chatgpt = { rate_limit: { primary_window: { limit_window_seconds: 604800, used_percent: 80 }, secondary_window: { limit_window_seconds: 18000, used_percent: 25, reset_at: 1735689600 } } }
const expected = { status: 'ok', fiveHour: { percent: 25, resetsAt: '2025-01-01T00:00:00.000Z' }, weekly: { percent: 80, resetsAt: null } }
const credential = { access: 'secret-token', expires: 2000, accountId: 'secret-account' }
const make = overrides => createUsageFetcher({ now: () => 1000, resolveCredential: async () => credential, fetch: async url => ({ ok: true, status: 200, json: async () => url.includes('anthropic') ? claude : chatgpt }), ...overrides })

test('parses both provider windows and normalizes reset times', () => {
  assert.deepEqual(parseClaudeUsage(claude), expected)
  assert.deepEqual(parseChatgptUsage(chatgpt), expected)
})

test('keeps valid windows while rejecting malformed percentages and timestamps', () => {
  for (const input of [null, {}]) {
    assert.deepEqual(parseClaudeUsage(input), { status: 'unexpected-format' })
    assert.deepEqual(parseChatgptUsage(input), { status: 'unexpected-format' })
  }
  for (const five_hour of [{ utilization: 101 }, { utilization: 5, resets_at: 'invalid' }]) {
    assert.deepEqual(parseClaudeUsage({ ...claude, five_hour }), { status: 'ok', weekly: expected.weekly })
  }
  assert.deepEqual(parseChatgptUsage({ rate_limit: { primary_window: chatgpt.rate_limit.primary_window, secondary_window: chatgpt.rate_limit.primary_window } }), { status: 'unexpected-format' })
  assert.deepEqual(parseChatgptUsage({ rate_limit: { ...chatgpt.rate_limit, secondary_window: { ...chatgpt.rate_limit.secondary_window, reset_at: 1e100 } } }), { status: 'ok', weekly: expected.weekly })
})

test('uses fixed endpoints, secure options and provider-specific headers', async () => {
  const calls = []
  const fetchUsage = make({ fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => url.includes('anthropic') ? claude : chatgpt } } })
  assert.deepEqual(await fetchUsage(), { claude: expected, chatgpt: expected })
  assert.equal(calls.length, 2)
  const a = calls.find(call => call.url === 'https://api.anthropic.com/api/oauth/usage')
  const c = calls.find(call => call.url === 'https://chatgpt.com/backend-api/wham/usage')
  assert.deepEqual(a.options.headers, { Authorization: 'Bearer secret-token', 'anthropic-beta': 'oauth-2025-04-20' })
  assert.deepEqual(c.options.headers, { Authorization: 'Bearer secret-token', 'chatgpt-account-id': 'secret-account' })
  for (const { options } of calls) { assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal) }
})

test('handles missing, expired and invalid credentials without fetching', async () => {
  for (const [value, status] of [[undefined, 'not-signed-in'], [{ ...credential, expires: 1000 }, 'token-expired'], [null, 'unavailable'], [{ ...credential, access: 'bad\r\ntoken' }, 'unavailable'], [{ ...credential, expires: Infinity }, 'unavailable'], [{ ...credential, expires: 1e100 }, 'unavailable']]) {
    const result = await make({ resolveCredential: async () => value, fetch: () => assert.fail('must not fetch') })()
    assert.deepEqual(result, { claude: { status }, chatgpt: { status } })
  }
  const result = await make({ resolveCredential: async name => name === 'chatgpt' ? { ...credential, accountId: '' } : undefined, fetch: () => assert.fail('must not fetch') })()
  assert.deepEqual(result, { claude: { status: 'not-signed-in' }, chatgpt: { status: 'unavailable' } })
})

test('accepts OpenCode OAuth credentials with an unknown expiry', async () => {
  assert.deepEqual(await make({ resolveCredential: async () => ({ ...credential, expires: 0 }) })(), { claude: expected, chatgpt: expected })
})

test('maps response and transport failures to safe statuses without exposing secrets', async () => {
  for (const [fetch, status] of [[async () => ({ status: 401 }), 'token-expired'], [async () => ({ status: 500, ok: false }), 'unavailable'], [async () => { throw Error('secret-token secret-account') }, 'unavailable'], [async () => ({ status: 200, ok: true, json: async () => { throw Error('secret-token') } }), 'unexpected-format'], [async () => ({ status: 200, ok: true, json: async () => ({ secret: 'secret-token' }) }), 'unexpected-format']]) {
    const result = await make({ fetch })()
    assert.deepEqual(result, { claude: { status }, chatgpt: { status } })
    assert.doesNotMatch(JSON.stringify(result), /secret/)
  }
  assert.deepEqual(await make({ resolveCredential: async () => { throw Error('secret-token') } })(), { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } })
})

test('times out even if resolver, fetch or body never settles, and aborts requests', async () => {
  const never = () => new Promise(() => {})
  for (const overrides of [{ resolveCredential: never }, { fetch: never }, { fetch: async () => ({ status: 200, ok: true, json: never }) }]) {
    assert.deepEqual(await make({ ...overrides, timeoutMs: 10 })(), { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } })
  }
  const signals = []
  await make({ timeoutMs: 10, fetch: (url, options) => { signals.push(options.signal); return never() } })()
  assert.equal(signals.length, 2)
  assert.ok(signals.every(signal => signal.aborted))
})

test('a stalled provider times out without hiding the healthy provider result', async () => {
  const calls = []
  const fetchUsage = make({ timeoutMs: 10, fetch: async url => {
    calls.push(url)
    if (url.includes('anthropic')) return new Promise(() => {})
    return { status: 200, ok: true, json: async () => chatgpt }
  } })
  const result = await fetchUsage()
  assert.deepEqual(result, { claude: { status: 'unavailable' }, chatgpt: expected })
  assert.equal(calls.length, 2)
  assert.doesNotMatch(JSON.stringify(result), /secret-token|secret-account/)
})

test('coalesces concurrent calls and permits a later refresh', async () => {
  let count = 0
  const fetchUsage = make({ resolveCredential: async () => { count++; return undefined } })
  const first = fetchUsage()
  assert.strictEqual(fetchUsage(), first)
  await first
  await fetchUsage()
  assert.equal(count, 4)
})
