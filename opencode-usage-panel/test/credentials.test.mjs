import test from 'node:test'
import assert from 'node:assert/strict'
import { credentialResolver } from '../src/credentials.mjs'

const oauth = { type: 'oauth', methodID: 'chatgpt-browser', access: 'test-token', expires: 12345, metadata: { accountID: 'test-account', email: 'private@example.invalid' } }

test('resolves the active OpenCode subscription credential without exposing extra fields', async () => {
  const requested = []
  const resolver = credentialResolver({ connection: {
    active: async id => { requested.push(id); return { id, type: 'credential', method: 'oauth' } },
    resolve: async () => oauth,
  } })
  assert.deepEqual(await resolver('claude'), { access: 'test-token', expires: 12345 })
  assert.deepEqual(await resolver('chatgpt'), { access: 'test-token', expires: 12345, accountId: 'test-account' })
  assert.deepEqual(requested, ['anthropic', 'openai'])
})

test('refuses API keys and unsupported ChatGPT token-sharing credentials', async () => {
  for (const credential of [
    { type: 'key', key: 'not-oauth' },
    { ...oauth, methodID: 'chatgpt-token-sharing' },
    { ...oauth, metadata: {} },
  ]) {
    const resolver = credentialResolver({ connection: { active: async () => ({ type: 'credential', method: 'oauth' }), resolve: async () => credential } })
    assert.equal(await resolver('chatgpt'), null)
  }
})

test('concurrent resolution shares an in-flight host lookup and permits retry', async () => {
  let finish
  let calls = 0
  const resolver = credentialResolver({ connection: {
    active: async () => ({ type: 'credential', method: 'oauth' }),
    resolve: () => { calls++; return new Promise(resolve => { finish = resolve }) },
  } })
  const first = resolver('chatgpt')
  const second = resolver('chatgpt')
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(calls, 1)
  finish(oauth)
  await first
  const third = resolver('chatgpt')
  await Promise.resolve()
  assert.equal(calls, 2)
  finish(oauth)
  await third
})

test('returns no credential when the provider has no active connection', async () => {
  const resolver = credentialResolver({ connection: { active: async () => undefined, resolve: async () => { throw new Error('unexpected') } } })
  assert.equal(await resolver('claude'), undefined)
})
