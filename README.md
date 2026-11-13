# AI Plugins

A collection of plugins for AI development tools. Each plugin lives in its own directory and has its own README and
tests.

## Plugins

- [OpenCode Gemini CLI Provider](opencode-gemini-cli-provider/) — adds Gemini CLI as a selectable OpenCode provider.
- [ZadLoop Gemini CLI Provider](zadloop-gemini-cli-provider/README.md) — adds Gemini CLI as a selectable ZadLoop model provider and delegation backend.
- [Donald Duck](donald-duck/README.md) — a local DSH Client overlay bundle for ZadLoop.
- [OpenCode Desktop themes](opencode-desktop-themes/README.md) — five native Desktop color themes.

## Development checks

Run the checks for the plugins from the repository root:

```sh
npm --prefix donald-duck test
npm --prefix opencode-gemini-cli-provider test
npm --prefix zadloop-gemini-cli-provider test
npm --prefix opencode-desktop-themes test
```

The duck checks rebuild its client bundle and run offline sprite/drag regressions; they do not render the installed
plugin. Both Gemini test suites are offline and do not make live model requests. See each plugin's README for runtime
requirements, setup, and verification limits.

## Vendor records

- [dsh-sidebar-browser-cdp](vendor/dsh-sidebar-browser-cdp/README.md) — provenance and pinned upstream commit for the profile-installed DSH sidebar browser plugin.
- [opencode-anthropic-login-via-cli](vendor/opencode-anthropic-login-via-cli/README.md) — provenance and pinned upstream commit for the globally configured OpenCode Anthropic authentication plugin.
