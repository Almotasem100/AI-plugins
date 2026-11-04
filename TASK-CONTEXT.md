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
- Current code is a `gemini_task` tool bridge in `src/index.js` and `src/gemini.js`; it is not a model provider. Existing
  tests cover that bridge only.

## Design decision and limitations

Use the public OpenCode V2 provider transform plus AI SDK hooks, with a small AI SDK V3 language-model adapter that
invokes Gemini CLI headlessly. The model is selectable inside OpenCode and the CLI owns authentication. Because the
Gemini SDK is not published as an npm package, this adapter uses the supported CLI headless interface rather than
depending on Gemini CLI internals.

This does not reproduce Claude Agent's private Core integration. Gemini CLI runs a separate agent/tool loop, so
OpenCode tool permissions/approval UI do not govern those operations; each model call starts a fresh CLI invocation;
media inputs and incremental token streaming are not supported yet. These limitations are user-visible in the README.
No live model request is authorized or needed for offline verification.

## Verification

- `npm test`: 11 tests pass.
- OpenCode V2.2.5 `opencode models` lists `gemini-cli/default` after loading the plugin.
- `opencode run --model gemini-cli/default` completed end-to-end against a temporary fake Gemini CLI and returned its
  fixture response. No Gemini authentication or live model request was used.
- The user's global `opencode.json` plugin path remains unchanged.
- The built-in selectable model inventory includes Gemini CLI default, Gemini 3.8 Flash, and Gemini 3.1 Pro Preview;
  explicit model entries pass their model ID to the CLI.

## References

- OpenCode V2 plugin guide: https://opencode.ai/v2/docs/build/plugins
- OpenCode V2 Effect plugin guide: https://opencode.ai/v2/docs/build/plugins/effect
- OpenCode V2 providers guide: https://opencode.ai/v2/docs/providers
- Claude Agent core implementation reference: https://github.com/anomalyco/opencode/tree/dev/packages/core/src/plugin/provider/claude-agent
- Gemini CLI headless reference: https://geminicli.com/docs/cli/headless/
- Gemini CLI SDK source (v0.66.0): https://github.com/google-gemini/gemini-cli/tree/v0.66.0/packages/sdk
