import { createUsageFetcher } from './src/usage.mjs';

export const inject = ['connection', 'credentials', 'llm', 'authorization'];

// A record key alone does not prove its provider. Join the directory and the
// authorization flow, and refuse multiple possible accounts rather than guess.
export async function routeForCatalog(llm, credentials, authorization, catalog) {
  const directory = llm.listConfigurableProviders();
  const records = await credentials.listRecords();
  const routes = [];
  for (const record of records) {
    if (record.kind !== 'grant' || !record.key.startsWith('llm-pi-ai/')) continue;
    const route = record.key.slice('llm-pi-ai/'.length);
    const entries = directory.filter(entry => entry.provider === route);
    if (entries.length !== 1) return undefined;
    const entry = entries[0];
    const family = entry.inherits ?? (!entry.declared ? route : undefined);
    if (entry.settingsNs !== 'llm-pi-ai') return undefined;
    // A failed base catalog route still identifies its own family, provided it
    // has no conflicting inheritance; errors on other routes are ambiguous.
    const knownBase = !entry.declared && !entry.inherits &&
      (route === 'anthropic' || route === 'openai-codex');
    if (family && family !== catalog && (!entry.error || knownBase)) continue;
    if (entry.error || family !== catalog) return undefined;
    const state = authorization.describe(record.key)?.usability?.state;
    if (state?.kind !== 'record-selected' || state.route !== route) return undefined;
    routes.push(route);
  }
  return routes.length === 1 ? routes[0] : undefined;
}

export function apply(ctx) {
  const getUsage = createUsageFetcher({
    credentials: ctx.credentials,
    fetch: globalThis.fetch,
    resolveProvider: catalog => routeForCatalog(ctx.llm, ctx.credentials, ctx.authorization, catalog),
  });
  let pending;
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/usage-panel',
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch() {
      try {
        if (!pending) pending = getUsage().finally(() => { pending = undefined; });
        const result = await pending;
        return Response.json(result, { headers: { 'cache-control': 'no-store' } });
      } catch {
        return Response.json({ error: 'unavailable' }, {
          status: 503,
          headers: { 'cache-control': 'no-store' },
        });
      }
    },
  }), 'usage-panel: subscription usage');
}
