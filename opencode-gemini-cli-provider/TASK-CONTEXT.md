# Native Gemini Agent Provider — Task Context

## Goal

Replace the `gemini_task` delegation tool with a selectable Gemini Agent model/provider in OpenCode V2, modeled on
OpenCode's Claude Agent integration. The intended experience is selecting Gemini for an OpenCode session (for example
through `/models`), not delegating a one-off task to a tool or subagent.

## Constraints

- Preserve Gemini CLI's existing authentication. Do not inspect, copy, or manage its credentials.
- Keep the plugin in `Repos/AI-plugins` and preserve the user's existing global plugin configuration.
- Use public OpenCode V2 plugin APIs and avoid an OpenCode core fork.
- Verify offline and provider registration behavior without making a live model request unless separately authorized.

## Evidence and current state

- The installed OpenCode is V2.3.0. Its public Effect plugin context exposes `ctx.provider.transform` and
  `ctx.aisdk.hook("sdk"/"language")`, which can contribute a selectable model and runtime implementation.
- OpenCode's built-in Claude Agent provider is a core plugin (`opencode.provider.claude-agent`) using private Core
  services. That exact internal integration cannot be copied by this standalone plugin.
- The installed Gemini CLI was observed as 0.68.0. It supports headless `--prompt` with `--output-format stream-json` and ACP via
  `--acp`; these use the CLI rather than reading its credentials.
- Gemini CLI's SDK source exists at `google-gemini/gemini-cli` tag `v0.66.0`, but
  `@google/gemini-cli-sdk` is not published in npm (npm registry returned 404), and its source package depends on the
  monorepo-local `@google/gemini-cli-core` package.
- Current code registers a selectable provider in `src/index.js`, adapts the AI SDK V3 language-model interface in
  `src/provider.js`, and invokes Gemini CLI through `src/gemini.js`. Offline tests cover the adapter and CLI boundary.
- The plugin requires Node.js 20.3.0 or later because cancellation combines signals with `AbortSignal.any`.

## Design decision and limitations

Use the public OpenCode V2 provider transform plus AI SDK hooks, with a small AI SDK V3 language-model adapter that
invokes Gemini CLI headlessly. The model is selectable inside OpenCode and the CLI owns authentication. Because the
Gemini SDK is not published as an npm package, this adapter uses the supported CLI headless interface rather than
depending on Gemini CLI internals.

This does not reproduce Claude Agent's private Core integration. Gemini CLI runs a separate agent/tool loop, so
OpenCode tool permissions/approval UI do not govern those operations. The owner chose to launch plugin-owned Gemini CLI
processes with `--approval-mode=yolo`; this is scoped to plugin requests and does not edit Gemini CLI settings. Each
model call starts a fresh CLI invocation.

Text requests use Gemini CLI's documented `stream-json` output; image requests keep ACP and forward
`agent_message_chunk` updates. Both paths stream assistant text to OpenCode while the request is active. The final
`result` event normally decides success or failure, with two additional safeguards: the installed CLI's known
terminal `Maximum session turns exceeded` error fails the request even when followed by `result.status: "success"`,
and a nonzero process exit remains a failure. Other `error` events are not by themselves terminal. With
`stream-json`, text from intermediate Gemini turns before a Gemini tool call is streamed too, which differs from the
earlier JSON mode that kept only the final turn. Failures use fixed safe classifications (startup, authentication,
quota, session turn limit, protocol, cancellation, process exit); arbitrary CLI diagnostic text is not included in
host-visible errors. Raw stderr is drained but never shown. This deliberately avoids treating regex redaction as a
confidentiality guarantee. Cleanup and child-close waits are bounded; owned pipes are closed if a child does not close
in time, and unconfirmed cleanup is surfaced. Windows descendant termination is not guaranteed.

Image support is covered offline with a fake ACP executable, not a live Gemini request. ACP limitation: Gemini CLI
can map underlying failures such as token exhaustion or safety blocking to `stopReason: "end_turn"`. The adapter
cannot distinguish a hidden failure from a complete non-empty response when ACP omits the cause. The YOLO behavior
remains user-visible in the README. Live model requests require separate authorization.

## Findings and blockers

- **Host tool bridge: not implemented; the previous impossibility claim is corrected.** OpenCode 2.3.0 adds
  `x-opencode-session-id` to model request headers
  ([`model-request.ts`](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/session/model-request.ts));
  AI SDK V3 call options expose headers, tools, prompt messages, and later tool results (the built-in Claude Agent
  reads the session header from
  [`options.headers`](https://github.com/anomalyco/opencode/blob/v2.3.0/packages/core/src/plugin/provider/claude-agent/language-model/claude-agent-language-model.ts)).
  `src/provider.js` already serializes host tool results in later prompts. An offline in-memory protocol model was
  explored but did not establish actual OpenCode host execution or Gemini CLI continuation.
  Production bridging stays disabled: Gemini CLI 0.68.0's `newSessionConfig` merges supplied ACP `mcpServers` into
  configured Gemini MCP servers (`gemini-Q2FNZWQG.js:17928–17943`), and Gemini's YOLO/native tools remain outside
  OpenCode permissions. Ambient/native MCP bypass, real process/session lifetime, production correlation, permission
  behavior, and cancellation are not proven. `experiment/tool-handoff.js` remains an older simplified IPC example.
- **Mid-request steering: not implemented.** OpenCode queues a message sent during a response and promotes it only at
  a step boundary (`SessionInbox` promotion inside `SessionRunner.drain`), so this one-step adapter receives it after
  the active Gemini turn ends. Gemini ACP's `session/prompt` aborts an existing prompt rather than appending to it, so
  sending a second prompt would cancel work, not steer it. The queued behavior is retained and not relabeled as
  steering.
- **Gemini CLI 0.68.0 max-turn evidence:** installed bundle
  `@google/gemini-cli/bundle/gemini-Q2FNZWQG.js` lines 13501–13521 emits a severity-`error` event with
  `Maximum session turns exceeded` for the `max_turns` agent-end reason, then calls `emitFinalResult()` without an
  error payload. Lines 13238–13247 serialize that as `result.status: "success"`. The provider recognizes this specific
  diagnostic as terminal; generic severity-`error` events remain recoverable when the final result says success.
- **ACP partial-failure ambiguity:** Gemini CLI ACP can map underlying failures including token exhaustion and safety
  blocking to `stopReason: "end_turn"` (`gemini-Q2FNZWQG.js:16765–16767`, per the inspected bundle). OpenCode and
  ZadLoop cannot reconstruct a hidden failure from that stop reason; both providers document this limit.

## Verification

- Latest coordinator verification on Windows: `npm test` passed all 40 OpenCode offline tests and the ZadLoop
  smoke test plus 44 offline tests. Sol's focused recheck found the three remaining lifecycle findings resolved;
  18 targeted existing tests and 37 additional offline probes passed. Real process-tree behavior remains unverified.
- Windows cleanup no longer treats an exited root as proof that its process tree is gone: a failed `taskkill` is
  reported alongside the request error in an `AggregateError`. The regression test confirms a detached descendant
  can remain alive after its root exits; the test terminates that fixture itself. Thus the false-success finding is
  fixed, but reliable termination of an orphaned descendant after the root PID disappears remains a process-tree
  cleanup limitation and is not claimed as solved.
- Exit-code classifications now use only the official headless reference's documented specific codes: `42` (input)
  and `53` (turn limit). Other nonzero codes, including `1`, retain the generic process-failure message. Spawn
  diagnostics are bounded/path-free and retain safe codes such as `ENOENT`.
- `node --check` passed for `src/gemini.js` and `test/gemini.test.js`; scoped `git diff --check` passed.
- The ZadLoop offline tests do not validate a live DSH host.
- No live Gemini request was made. Fake CLI tests do not prove live `stream-json` or ACP behavior. OpenCode host
  integration was not re-run; POSIX execution and the Node.js 20.3.0 minimum were not verified.

Earlier integration verification (not rerun during this review):

- OpenCode V2.2.5 `opencode models` listed `gemini-cli/default` after loading the plugin (historical; the alias remains
  in the current inventory).
- `opencode run --model gemini-cli/default` completed end-to-end against a temporary fake Gemini CLI and returned its
  fixture response (historical). No Gemini authentication or live model request was used.
- The user's global `opencode.json` plugin path remains unchanged.
- At the time of that integration check, the inventory included Gemini CLI default, Gemini 3.8 Flash, and Gemini 3.1 Pro
  Preview; explicit model entries passed their model ID to the CLI. The current built-in inventory retains the default
  alias and those two explicit models.

## References

- OpenCode V2 plugin guide: https://opencode.ai/v2/docs/build/plugins
- OpenCode V2 Effect plugin guide: https://opencode.ai/v2/docs/build/plugins/effect
- OpenCode V2 providers guide: https://opencode.ai/v2/docs/providers
- Claude Agent core implementation reference: https://github.com/anomalyco/opencode/tree/dev/packages/core/src/plugin/provider/claude-agent
- Gemini CLI headless reference: https://geminicli.com/docs/cli/headless/
- Gemini CLI SDK source (v0.66.0): https://github.com/google-gemini/gemini-cli/tree/v0.66.0/packages/sdk
