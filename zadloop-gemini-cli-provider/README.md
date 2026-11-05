# ZadLoop Gemini CLI Provider

Adds `gemini-cli` as a selectable ZadLoop model provider with exactly two model IDs: `gemini-3.8-flash` and `gemini-3.1-pro-preview`. It also registers model-specific one-shot delegation tools: `gemini_flash_subagent` uses Flash and `gemini_pro_subagent` uses Pro Preview. Each request runs a fresh headless Gemini CLI process in the active Session's working directory and uses Gemini CLI's existing local authentication; the plugin does not read or copy credentials.

## Requirements

- ZadLoop with the `llm`, `subprocess`, `sessions`, `workingDirectory`, and `subagents` services enabled
- Node.js 20.3 or later in the host runtime
- Gemini CLI installed and authenticated

## Install

Install this directory as a local bundle through ZadLoop's Plugin Manager. The bundle registers the `gemini-cli` LLM route and the `gemini_flash_subagent` and `gemini_pro_subagent` tools. Ask ZadLoop to use the tool matching the desired model for a self-contained task; the parent receives the result through the normal subagent completion flow. Delegated work does not inherit the parent's full conversation or support follow-up messages. For ordinary model calls, choose one of the two listed model IDs in model selection.

## Important behavior

- Gemini CLI is launched with `--approval-mode=yolo`. Its own tool actions run in a separate agent loop under your OS user account and are **not** governed by ZadLoop's per-tool approval or workspace sandbox UI. Treat them as unrestricted host actions; use only where you accept that trust boundary.
- Each model call starts a new Gemini CLI process; no persistent Gemini session or incremental response streaming is provided.
- This adapter advertises text-only input, does not report token usage, and does not translate ZadLoop reasoning-effort settings.
- The model catalog contains only `gemini-3.8-flash` and `gemini-3.1-pro-preview`; every call passes its selected model ID explicitly to Gemini CLI. Delegation uses `gemini_flash_subagent` for Flash or `gemini_pro_subagent` for Pro Preview.
- On Windows, the system `where.exe` locates the npm CLI shim and the plugin launches Gemini's bundled JavaScript entry point through `node.exe`, avoiding shell interpolation of the task. Model IDs are strictly validated and the task itself is sent over stdin.

## Verify

```sh
npm test
```

Tests are offline and use a fake subprocess seam. They do not make a live Gemini request.
