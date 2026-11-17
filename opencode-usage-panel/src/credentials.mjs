// Only OpenCode's documented Codex OAuth methods provide the account ID used by wham/usage.
const CODEX_METHODS = new Set(['chatgpt-browser', 'chatgpt-headless'])

export function credentialResolver(integration) {
  const pending = new Map()
  async function readCredential(provider) {
    const integrationID = provider === 'claude' ? 'anthropic' : 'openai'
    const connection = await integration.connection.active(integrationID)
    if (!connection) return undefined
    if (connection.type !== 'credential' || connection.method !== 'oauth') return null
    const credential = await integration.connection.resolve(connection)
    if (!credential || credential.type !== 'oauth') return null
    if (provider === 'chatgpt' && (!CODEX_METHODS.has(credential.methodID) || typeof credential.metadata?.accountID !== 'string')) return null
    return {
      access: credential.access,
      expires: credential.expires,
      ...(provider === 'chatgpt' ? { accountId: credential.metadata.accountID } : {}),
    }
  }
  return function resolveCredential(provider) {
    if (!pending.has(provider)) {
      pending.set(provider, readCredential(provider).finally(() => pending.delete(provider)))
    }
    return pending.get(provider)
  }
}
