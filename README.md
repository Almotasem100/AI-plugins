# AI Plugins

A collection of plugins for AI development tools. Each plugin lives in its own directory and has its own README and
tests.

## Plugins

- [OpenCode Gemini CLI Provider](opencode-gemini-cli-provider/) — adds Gemini CLI as a selectable OpenCode provider.
- [Donald Duck](donald-duck/README.md) — a local DSH Client overlay bundle for ZadLoop.

## Development checks

Run the checks for both plugins from the repository root:

```sh
npm --prefix donald-duck test
npm --prefix opencode-gemini-cli-provider test
```

The duck checks rebuild its client bundle and run offline sprite/drag regressions; they do not render the installed
plugin. The Gemini checks use a fake CLI and do not make live model requests. See each plugin's README for runtime
requirements, setup, and verification limits.

## Vendor records

- [dsh-sidebar-browser-cdp](vendor/dsh-sidebar-browser-cdp/README.md) — provenance and pinned upstream commit for the profile-installed DSH sidebar browser plugin.
