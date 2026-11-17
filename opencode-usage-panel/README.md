# OpenCode subscription usage

An OpenCode Desktop GUI plugin that shows Claude and ChatGPT subscription usage on demand. Select the statistics icon near the context indicator to fetch 5-hour and weekly percentages and reset times, or use **Refresh**. It does not poll or use a model.

## Requirements

- OpenCode Desktop 2.3.0; its GUI plugin API is experimental.
- An active Claude subscription OAuth connection for Claude usage.
- An active OpenAI Codex browser or device-code OAuth connection with an account ID for ChatGPT usage. OpenCode's `chatgpt-token-sharing` method is not supported because its credential does not provide the account ID required by the tested Codex usage endpoint.

The plugin resolves each provider's active connection using OpenCode's host integration API. OpenCode may refresh an expiring OAuth credential during resolution. The plugin does not read credential files or send credentials to the GUI. If no supported connection exists or a provider rejects the request, the panel reports the usage as unavailable. A credential lookup that never finishes remains in flight to avoid starting overlapping lookups; if it stays stuck, restart the OpenCode host before retrying. Both provider usage endpoints are undocumented and may change without notice; provider policies may restrict use of subscription OAuth credentials by third-party tools.

## Install

Add this directory's absolute path to the existing `plugins` array in `~/.config/opencode/opencode.json`, preserving the other entries. Open the panel from a session's header after the session has loaded.

## Verify

Run `npm test` in this directory. Tests use fake credentials and network responses; they do not make live provider requests or exercise the installed Desktop GUI.
