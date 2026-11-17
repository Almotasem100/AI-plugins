import { Plugin } from '@opencode/plugin'
import { Usage } from './rpc.js'
import { credentialResolver } from './credentials.mjs'
import { createUsageFetcher } from './usage.mjs'

export default Plugin.define({
  id: 'subscription-usage',
  async setup(ctx) {
    const fetchUsage = createUsageFetcher({ resolveCredential: credentialResolver(ctx.integration), fetch: globalThis.fetch })
    const registration = await ctx.rpc.register(Usage, { refresh: () => fetchUsage() })
    return () => registration.dispose()
  },
})
