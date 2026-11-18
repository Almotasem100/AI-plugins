# OpenCode Gemini CLI Provider

This plugin adds a **Gemini** provider with two models and a default alias to OpenCode's `/models` list. OpenCode sends the
session's conversation to the installed Gemini CLI, which generates the response using the selected model.

This is a model/provider integration, **not** a `gemini_task` tool. Gemini CLI keeps its existing authentication and
runs its own agent/tool loop; this plugin does not read or copy Gemini credentials.

## Requirements

- OpenCode 2.2.5 or later
- Node.js 20.3.0 or later
- Gemini CLI installed and authenticated (`gemini --version` / `gemini`)

## Install locally

Add this directory to the `plugins` array in your global OpenCode configuration (`~/.config/opencode/opencode.json`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "C:/path/to/Repos/AI-plugins/opencode-gemini-cli-provider"
  ]
}
```

If the configuration already exists, add the plugin path to its existing `plugins` array and preserve its other settings.
OpenCode watches configuration files and loads plugin changes without requiring a restart. To remove the provider, remove
this path from `plugins` and remove the sample agent file if you copied it.

## Use

After the plugin loads, choose a model in `/models`. The provider runs Gemini CLI from the current project directory
and uses the CLI's existing login.

- `gemini-cli/gemini-3.8-flash` selects **Gemini 3.8 Flash**.
- `gemini-cli/gemini-3.1-pro-preview` selects **Gemini 3.1 Pro Preview**.
- `gemini-cli/default` is an alias for **Gemini 3.8 Flash**, including for existing subagents using this ID.

Other Gemini CLI model IDs can be added under `providers.gemini-cli.models` in OpenCode configuration. Each entry's
`modelID` field carries the CLI model ID; use the same ID as the map key for readability.

## Use Gemini as a subagent

The provider makes Gemini selectable as a model; OpenCode also needs an agent definition to dispatch it as a named
subagent. Copy [`agents/gemini.md`](agents/gemini.md) into the `agents/` directory of your OpenCode config:

- Windows: `%USERPROFILE%\.config\opencode\agents\gemini.md`
- macOS/Linux: `~/.config/opencode/agents/gemini.md` (or the equivalent under `XDG_CONFIG_HOME`)

Create the `agents/` directory if it does not exist, then start a new session and ask OpenCode to use the **Gemini**
subagent, for example: “Ask the Gemini subagent to summarize the project README.”

**Security note:** Gemini CLI runs its own tool loop in YOLO mode for plugin requests. Its actions are not governed by
OpenCode's per-tool permissions or approval UI; review the YOLO behavior under [Important behavior](#important-behavior)
before enabling this subagent.

## Effort and variants

OpenCode effort variants are not exposed by this provider yet. Gemini CLI has its own model-generation configuration,
including thinking settings. This adapter does not translate OpenCode variant choices into Gemini CLI settings, so set
thinking effort through Gemini CLI configuration. Those generation settings continue to apply to plugin requests.

## Important behavior

- Gemini CLI's own tools perform agent actions. OpenCode's tool permissions, tool-call UI, and approval flow do **not**
  govern those actions. For calls started by this plugin, Gemini CLI is explicitly launched with
  `--approval-mode=yolo`, so it auto-approves tool actions. This is scoped to plugin-launched processes; it does not
  change your `~/.gemini/settings.json` or normal Gemini CLI sessions. Other Gemini CLI security policies may still
  block an action.
- Each OpenCode model request starts a Gemini CLI invocation and sends the available text transcript. This
  adapter does not preserve a persistent Gemini CLI session between requests.
- PNG, JPEG, WebP, and GIF image attachments are sent through Gemini CLI's ACP image input. Image URLs and other
  file types fail explicitly rather than being dropped. Image requests require a Gemini CLI version with ACP image support.

### Streaming and errors

- Text requests use Gemini CLI's `stream-json` output and image requests use ACP updates. Assistant text is forwarded
  to OpenCode as Gemini produces it, so the response appears while the request is still running.
- For image requests, the adapter forwards text only from the ACP session it opened and stops on malformed or
  unmatched JSON-RPC responses.
- With `stream-json`, text emitted during intermediate Gemini turns (before one of Gemini's own tool calls) is also
  streamed. OpenCode shows that text before the final answer; it is not a separate tool card.
- For headless `stream-json` requests, the CLI's final `result` event normally decides
  success or failure. The known terminal `Maximum session turns exceeded` error is
  also treated as failure, even if the CLI follows it with a successful result. Other
  `error` events do not fail a request that ends successfully, and a nonzero exit code
  remains a failure. Partial text followed by failure is never reported as a completed
  response.
- Startup, authentication, quota/rate-limit, session turn-limit, protocol, cancellation, and process failures become
  fixed safe classifications. Raw stderr and arbitrary CLI diagnostic text are not included in user-facing errors;
  this avoids treating regex-based redaction as a confidentiality guarantee.
- Cumulative CLI output is limited to 16 MiB. Requests time out after 15 minutes. Cancellation, a timeout, an output
  limit, or consumer cancellation requests Gemini CLI process-tree termination. Cleanup and child-close waits are
  bounded; owned pipes are closed if the child does not close in time, and unconfirmed cleanup is surfaced rather
  than treated as success. Windows descendant termination is not guaranteed, especially after the root exits.
  `stream.cancel()` waits for the bounded cleanup outcome before resolving.

ACP limitation: Gemini CLI can map some underlying failures (including token exhaustion or safety blocking) to
`stopReason: "end_turn"`. The adapter cannot identify a hidden failure from a non-empty response when ACP reports
only that stop reason; such a response may appear complete.

### Steering and host tools

Queued-message steering is not forwarded into an active Gemini turn. OpenCode delivers a message sent during a
response only when the run reaches a step boundary, and Gemini's ACP `session/prompt` aborts an active prompt instead
of appending to it, so this adapter cannot steer a running request. The message waits for the current Gemini turn to
finish.

A host tool bridge is not implemented. OpenCode 2.3.0 supplies `x-opencode-session-id` in model request headers, and
the AI SDK language-model interface supplies tools plus their results on a later model step.
Production bridging remains disabled: the installed Gemini ACP implementation merges injected MCP servers with
Gemini's configured MCP servers, and this YOLO-launched CLI also retains native tools outside OpenCode permissions.
The plugin has not demonstrated isolation from those bypasses, real ACP/MCP parked continuation, or production
correlation, cancellation, and permission behavior.

### Future tasks

- Investigate a host-controlled tool bridge; implement it only after proving host permission enforcement,
  session isolation and correlation, cancellation, and exclusion of native and ambient tool bypasses.
- Investigate mid-request steering when host and Gemini interfaces can support it without cancelling or replacing
  the active request.

## Development

```sh
npm test
```

Tests are offline and use a fake Gemini executable. They do not make a live model request. See the
[design and verification record](TASK-CONTEXT.md) for earlier host checks and limits of the tool-handoff experiment.
