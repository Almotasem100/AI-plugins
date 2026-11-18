# OpenCode subscription usage

An OpenCode Desktop GUI plugin that shows Claude and ChatGPT subscription usage on demand. Select the statistics icon near the context indicator to fetch 5-hour and weekly percentages and reset times, or use **Refresh**. It does not poll or use a model.

## Requirements

- OpenCode Desktop 2.3.0; its GUI plugin API is experimental.
- An active Claude subscription OAuth connection for Claude usage.
- An active OpenAI Codex browser or device-code OAuth connection with an account ID for ChatGPT usage. OpenCode's `chatgpt-token-sharing` method is not supported because its credential does not provide the account ID required by the tested Codex usage endpoint.

The plugin resolves each provider's active connection through OpenCode. OpenCode may refresh an expiring OAuth
credential during resolution. The plugin does not read credential files or send credentials to the GUI.

- No active connection: **Not signed in**.
- Unsupported connection: **Unavailable**.
- Expired credential or HTTP 401: **Session expired**.
- Stuck credential lookup: it remains in flight to prevent duplicate lookups. If it does not recover, restart the
  OpenCode host before retrying.

Both provider usage endpoints are undocumented and may change without notice. Provider policies may restrict
third-party use of subscription OAuth credentials.

## Install

Add this directory's absolute path to the existing `plugins` array in your global `opencode.json` or `opencode.jsonc`, preserving the other entries. Open the panel from a session's header after the session has loaded. To remove both the server and Desktop parts, remove this directory's entry from `plugins`.

## Verify

Run `npm test` in this directory. Tests use fake credentials and network responses; they do not make live provider requests or exercise the installed Desktop GUI. See the [Desktop verification record](HANDOFF.md) for previously observed behavior and remaining manual checks.
