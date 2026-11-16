import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, routeForCatalog } from '../index.js';

const base = { provider: 'openai-codex', settingsNs: 'llm-pi-ai', declared: false };
const custom = { provider: 'my-codex', settingsNs: 'llm-pi-ai', declared: true, inherits: 'openai-codex' };
const auth = { describe(key) { return { usability: { state: { kind: 'record-selected', route: key.slice('llm-pi-ai/'.length) } } }; } };
const records = (...routes) => ({ listRecords: async () => routes.map(route => ({ key: `llm-pi-ai/${route}`, kind: 'grant' })) });

test('joins route directory, records, and authorization without guessing', async () => {
  const llm = { listConfigurableProviders: () => [base, custom] };
  assert.equal(await routeForCatalog(llm, records('my-codex'), auth, 'openai-codex'), 'my-codex');
  assert.equal(await routeForCatalog(llm, records('openai-codex', 'my-codex'), auth, 'openai-codex'), undefined);
  assert.equal(await routeForCatalog(llm, records('unknown'), auth, 'openai-codex'), undefined);
  assert.equal(await routeForCatalog(llm, records('my-codex'), { describe: () => ({ usability: { state: { kind: 'api-key-override', route: 'my-codex' } } }) }, 'openai-codex'), undefined);
  llm.listConfigurableProviders = () => [custom, { provider: 'anthropic', settingsNs: 'llm-pi-ai', declared: false, error: 'invalid' }];
  assert.equal(await routeForCatalog(llm, records('my-codex', 'anthropic'), auth, 'openai-codex'), 'my-codex');
  llm.listConfigurableProviders = () => [custom, { provider: 'anthropic', settingsNs: 'other', declared: false }];
  assert.equal(await routeForCatalog(llm, records('my-codex', 'anthropic'), auth, 'openai-codex'), undefined);
  llm.listConfigurableProviders = () => [custom, { provider: 'anthropic', settingsNs: 'llm-pi-ai', declared: false, inherits: 'other', error: 'invalid' }];
  assert.equal(await routeForCatalog(llm, records('my-codex', 'anthropic'), auth, 'openai-codex'), undefined);
  llm.listConfigurableProviders = () => [custom, { provider: 'other-account', settingsNs: 'llm-pi-ai', declared: true, inherits: 'anthropic', error: 'invalid' }];
  assert.equal(await routeForCatalog(llm, records('my-codex', 'other-account'), auth, 'openai-codex'), undefined);
  llm.listConfigurableProviders = () => [custom, { provider: 'mystery', settingsNs: 'llm-pi-ai', declared: true, error: 'invalid' }];
  assert.equal(await routeForCatalog(llm, records('my-codex', 'mystery'), auth, 'openai-codex'), undefined);
  llm.listConfigurableProviders = () => [custom, custom];
  assert.equal(await routeForCatalog(llm, records('my-codex'), auth, 'openai-codex'), undefined);
});

test('authenticated connection route returns sanitized statuses and disposes', async () => {
  let route;
  let disposed = false;
  const ctx = {
    credentials: { ...records(), readRecord: async () => undefined },
    authorization: auth,
    llm: { listConfigurableProviders: () => [base] },
    connection: { fetch: { register(value) { route = value; return () => { disposed = true; }; } } },
    effect(register) { this.dispose = register(); },
  };
  apply(ctx);
  assert.equal(route.path, '/api/usage-panel');
  assert.deepEqual(route.methods, ['GET']);
  const response = await route.fetch(new Request('http://localhost/api/usage-panel'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { claude: { status: 'unavailable' }, chatgpt: { status: 'unavailable' } });
  ctx.dispose();
  assert.equal(disposed, true);
});
