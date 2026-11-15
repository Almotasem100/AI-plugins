# ZadLoop Gemini CLI Provider

Adds `gemini-cli` as a selectable ZadLoop model provider with two models: `gemini-3.8-flash` and `gemini-3.1-pro-preview`. The `default` model ID is an alias for Gemini 3.8 Flash. It also registers model-specific one-shot delegation tools: `gemini_flash_subagent` uses Flash and `gemini_pro_subagent` uses Pro Preview. Each request runs a fresh Gemini CLI process in the active Session's working directory and uses Gemini CLI's existing local authentication; the plugin does not read or copy credentials.

## Requirements

- ZadLoop with the `llm`, `subprocess`, `sessions`, `workingDirectory`, `subagents`, and `attachments` services enabled
- Node.js 20.3 or later in the host runtime
- Gemini CLI installed and authenticated

## Install

Install this directory as a local bundle through ZadLoop's Plugin Manager. The bundle registers the `gemini-cli` LLM route and the `gemini_flash_subagent` and `gemini_pro_subagent` tools. Ask ZadLoop to use the tool matching the desired model for a self-contained task; the parent receives the result through the normal subagent completion flow. Delegated work does not inherit the parent's full conversation or support follow-up messages. For ordinary model calls, choose a model or the Flash default alias in model selection.

## Important behavior

- Gemini CLI is launched with `--approval-mode=yolo`. Its own tool actions run in a separate agent loop under your OS user account and are **not** governed by ZadLoop's per-tool approval or workspace sandbox UI. Treat them as unrestricted host actions; use only where you accept that trust boundary. Gemini's internal tool events are not reported as ZadLoop tool calls.
- Text-only model calls use Gemini CLI's headless `--output-format stream-json` mode. Assistant text is yielded as incremental `text-delta` events while the request is active; the final `result` event decides success, except the installed CLI's known terminal `Maximum session turns exceeded` error also fails even when followed by a successful result. Other error events remain nonfatal when the final result succeeds.
- Image-bearing model calls use ACP, which is Gemini CLI's supported image-input path. ACP assistant text chunks are likewise yielded incrementally. The adapter accepts ZadLoop image attachments (PNG, JPEG, WebP, and GIF) subject to ZadLoop's attachment limits and normalization; unsupported images or an ACP image-capability failure return an error. Delegation remains text-only.
- Each model call starts a new Gemini CLI process. ACP client requests that would require a ZadLoop-side response, including permission requests, are rejected rather than approved automatically. Cancellation or a consumer that stops reading terminates the process; it does not continue in the background.
- For headless text calls, empty success, missing final results, malformed or
  incomplete JSONL, and nonzero exits are errors. ACP image calls require non-empty
  text and an `end_turn` stop reason. Both paths reject cumulative output over 16 MiB.
  If text was already delivered before a later terminal failure, the stream still
  ends with an error rather than a successful finish.
- Error messages use fixed safe classifications where the protocol or process boundary supplies enough evidence: authentication, quota/rate limit, configuration/input, protocol, and process exit. Raw stderr and arbitrary structured-provider diagnostics are not included in host-visible errors. This avoids claiming that regex redaction can guarantee confidentiality.
- ACP limitation: Gemini CLI can map underlying failures such as token exhaustion or safety blocking to `stopReason: "end_turn"`. The adapter cannot distinguish those cases from a complete non-empty answer when ACP hides the cause, so a truncated response may appear complete.
- The adapter does not report token usage or translate ZadLoop reasoning-effort settings.
- The catalog contains `gemini-3.8-flash`, `gemini-3.1-pro-preview`, and the Flash alias `default`; every call passes the concrete model ID explicitly to Gemini CLI. Delegation uses `gemini_flash_subagent` for Flash or `gemini_pro_subagent` for Pro Preview.
- On Windows, the system `where.exe` locates the npm CLI shim and the plugin launches Gemini's bundled JavaScript entry point through `node.exe`, avoiding shell interpolation of the task. Model IDs are strictly validated and the task itself is sent over stdin.

## Host tool bridge and steering

Neither host-controlled tool bridging nor steering is implemented.

- The published `@deepseek-ai/dsh-llm` contract exposes `GenerateOptions.sessionId`, tool schemas, and messages; its stream can emit `tool-call-delta` chunks. The published `@deepseek-ai/dsh-agent-loop` 0.2.2-rc.2 loop executes tool calls after the assistant stream settles and supplies results on its next model step. These host interfaces make a correlated parking/resume design plausible; they do not prove a production bridge.
- Gemini CLI 0.68 ACP `session/new` accepts client-supplied `mcpServers`. A production bridge would need to retain a parked ACP/MCP request across model calls, correlate the host session and tool result, isolate concurrent sessions, propagate cancellation and rejection, and exclude Gemini-native and ambient MCP bypasses. The plugin starts a fresh process per request and has not proven those gates.
- Emitting Gemini's internal actions as ZadLoop tool calls without routing the MCP request and resuming it with the actual host result would falsely claim host execution and approval. The plugin therefore leaves Gemini's YOLO tool loop independent and discloses that boundary above.
- Gemini CLI 0.68 ACP aborts an in-flight `session/prompt` when a second prompt arrives (`this.pendingPrompt?.abort()` in the installed ACP session implementation). A second prompt is therefore cancellation/replacement, not steering. The ZadLoop adapter stream has no supported mid-stream message channel, so queued or restarted messages are not relabelled as steering.

The previous claim that host session identity, tool results, or a host execution seam are unavailable was too strong. Production bridging remains disabled until the listed isolation, authorization, correlation, concurrency, and cancellation gates are proven.

## Host compatibility

The declared peer range keeps `@deepseek-ai/dsh-llm` `0.2.1-rc.2`, `0.2.2-rc.1`, and adds `0.2.2-rc.2` for the reported DSH `0.2.2-rc.2` warning.

The addition is based on a read-only comparison of the published packages, not a live DSH runtime:

- `lib/types/types.d.ts`, `lib/types/assistant-stream.d.ts`, `lib/types/message.d.ts`, and `lib/types/brand.d.ts` are byte-identical between `0.2.2-rc.1` and `0.2.2-rc.2`.
- In `lib/types/index.d.ts`, the only changes are `LlmError`: its constructor now requires `BuiltinLlmFailureCode` instead of any string, and `LlmError.fromFailure` was added. The `LlmAdapter` class declaration is byte-identical, so `stream`, `resolveModel`, `listModels`, and `imageRequestTarget` are unchanged.
- `0.2.2-rc.2` moves `HarnessError` to a new `@deepseek-ai/dsh-error` peer dependency and narrows `LlmError`. This plugin imports only `LlmAdapter` and does not construct `LlmError` or `HarnessError`, so the narrowing does not affect it. The host installation must provide the new peer dependency.
- The offline tests substitute a local `LlmAdapter` stub; they do not load the real host package and cannot prove runtime compatibility. DSH `0.2.2-rc.2` with this plugin has not been live-validated here.

## Verify

```sh
npm test
```

Tests are offline and use fake subprocess/CLI boundaries. They cover incremental text and image chunks, split UTF-8, cumulative output limits, nonfatal warnings, terminal errors after partial output, redaction, cancellation, early consumer close, model aliases, and rejected ACP client requests. They do not make a live Gemini request or start a real ZadLoop host.
