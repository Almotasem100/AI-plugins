# OpenCode Gemini CLI Provider

This plugin adds a **Gemini** provider and the selectable model `gemini-cli/default` to OpenCode's `/models` list. When
you select it, OpenCode sends the session's text conversation to the installed Gemini CLI, which generates the
response. By default, Gemini CLI chooses which Gemini model to use.

This is a model/provider integration, **not** a `gemini_task` tool. Gemini CLI keeps its existing authentication and
runs its own agent/tool loop; this plugin does not read or copy Gemini credentials.

## Requirements

- OpenCode 2.2.5 or later
- Node.js 20 or later
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
OpenCode watches configuration files and loads plugin changes without requiring a restart.

## Use

After the plugin loads, choose a model in `/models`. The provider runs Gemini CLI from the current project directory
and uses the CLI's existing login.

- `gemini-cli/gemini-3.8-flash` selects **Gemini 3.8 Flash**.
- `gemini-cli/gemini-3.1-pro-preview` selects **Gemini 3.1 Pro Preview**.
- `gemini-cli/default` omits a model override and lets Gemini CLI choose. Its fallback may differ from the model you
  expected; choose one of the explicit entries above to pin the model.

Other Gemini CLI model IDs can be added under `providers.gemini-cli.models` in OpenCode configuration, with the model ID
as the map key and `modelID` value.

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
- Each OpenCode model request starts a headless Gemini CLI invocation and sends the available text transcript. This
  adapter does not preserve a persistent Gemini CLI session between requests.
- Text prompts are supported. Media/file prompt parts currently fail explicitly rather than being dropped.
- Output is delivered after the Gemini CLI invocation completes; the OpenCode stream adapter does not provide
  incremental token streaming yet.
- Requests time out after 15 minutes. Cancellation stops the Gemini CLI process tree.

## Development

```sh
npm test
```

Tests are offline and use a fake Gemini executable. They do not make a live model request.
