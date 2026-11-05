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

- The installed OpenCode is V2.2.5. Its public Effect plugin context exposes `ctx.provider.transform` and
  `ctx.aisdk.hook("sdk"/"language")`, which can contribute a selectable model and runtime implementation.
- OpenCode's built-in Claude Agent provider is a core plugin (`opencode.provider.claude-agent`) using private Core
  services. That exact internal integration cannot be copied by this standalone plugin.
- The installed Gemini CLI is 0.66.0. It supports headless `--prompt` with `--output-format stream-json` and ACP via
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
model call starts a fresh CLI invocation; media inputs and incremental token streaming are not supported yet. These
limitations and the YOLO behavior are user-visible in the README. No live model request is authorized or needed for
offline verification.

## Verification

- Current review: `npm test` passes all 13 offline tests on Windows with Node.js 22.19.0, including a real subprocess
  launch failure for a missing working directory and process-tree shutdown after output above the 16 MiB limit. The fake
  CLI tests also verify YOLO arguments and cancellation.
- Current review: `node --check` passes for all three source files and both test files.
- POSIX execution and Node.js 20.3.0 minimum-version verification were not run during this review.

Earlier integration verification (not rerun during this review):

- OpenCode V2.2.5 `opencode models` listed `gemini-cli/default` after loading the plugin (historical; this model was
  subsequently removed from the plugin inventory).
- `opencode run --model gemini-cli/default` completed end-to-end against a temporary fake Gemini CLI and returned its
  fixture response (historical). No Gemini authentication or live model request was used.
- The user's global `opencode.json` plugin path remains unchanged.
- At the time of that integration check, the inventory included Gemini CLI default, Gemini 3.8 Flash, and Gemini 3.1 Pro
  Preview; explicit model entries passed their model ID to the CLI. The current built-in inventory is the two explicit
  models only.

## References

- OpenCode V2 plugin guide: https://opencode.ai/v2/docs/build/plugins
- OpenCode V2 Effect plugin guide: https://opencode.ai/v2/docs/build/plugins/effect
- OpenCode V2 providers guide: https://opencode.ai/v2/docs/providers
- Claude Agent core implementation reference: https://github.com/anomalyco/opencode/tree/dev/packages/core/src/plugin/provider/claude-agent
- Gemini CLI headless reference: https://geminicli.com/docs/cli/headless/
- Gemini CLI SDK source (v0.66.0): https://github.com/google-gemini/gemini-cli/tree/v0.66.0/packages/sdk
