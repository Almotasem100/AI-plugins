# AI Plugins

Local plugins for OpenCode and ZadLoop. Each plugin is independently installable from its own directory;
follow its README for setup and host requirements.

## OpenCode

| Plugin | Host part | What it does |
| --- | --- | --- |
| [Gemini CLI provider](opencode-gemini-cli-provider/README.md) | Server | Adds locally authenticated Gemini CLI models. |
| [Subscription usage](opencode-usage-panel/README.md) | Server + Desktop GUI (experimental API) | Shows Claude and ChatGPT subscription usage on demand. |
| [Desktop themes](opencode-desktop-themes/README.md) | Desktop GUI (experimental API) | Adds color palettes to the native theme picker. |

## ZadLoop

| Plugin | Host part | What it does |
| --- | --- | --- |
| [Gemini CLI provider](zadloop-gemini-cli-provider/README.md) | Host | Adds Gemini CLI as a selectable model provider and delegation backend. |
| [Subscription usage](usage-panel/README.md) | Host + Client | Shows Claude and ChatGPT subscription usage on demand. |
| [Donald Duck](donald-duck/README.md) | Client | Adds a movable duck overlay. |
| [Workflow Dashboard (Stage 1)](zadloop-workflow-dashboard/README.md) | Adapter only (not installable yet) | Stage 1 host feasibility and read-only zero-model-call evidence adapter. |

## Development

Use Node.js 22 to match CI. From the repository root:

```sh
npm test
npm --prefix opencode-usage-panel test
```

The first command runs all six offline suites; the second shows how to run just one.
No dependency install, harness, or subscription sign-in is needed for these checks.
See [Contributing](CONTRIBUTING.md) for package boundaries, adding a plugin, and live verification.

## Vendor records

[`vendor/`](vendor/) documents third-party plugins configured outside this repository. It contains provenance records, not installable copies:

- [dsh-sidebar-browser-cdp](vendor/dsh-sidebar-browser-cdp/README.md) — ZadLoop sidebar browser.
- [opencode-anthropic-login-via-cli](vendor/opencode-anthropic-login-via-cli/README.md) — OpenCode Anthropic authentication.
