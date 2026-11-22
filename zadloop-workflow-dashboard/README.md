# ZadLoop Workflow Dashboard — Stage 1 (Feasibility & Read-Only Evidence Adapter)

**Status:** Stage 1 only (host API feasibility + headless deterministic evidence adapter). **Not installable yet** — no ZadLoop bundle/client entry point exists in Stage 1, and **Stage 2 UI remains blocked pending Stage 1 evaluation and owner approval.**

- **Target harness:** ZadLoop Desktop (`0.11.2` inspected read-only; no live host installation performed).
- **Install / remove:** Not applicable in Stage 1 (offline Node module only; no external dependencies, credentials, or host permissions required).

## Design invariants preserved

- **Read-only:** never writes to scratchpads, workflow files, or host state.
- **Zero additional AI/model calls:** purely deterministic local file/metadata parsing; missing or unparseable evidence renders `Unknown`, never calls a model.
- **No duplicate workflow state:** reads existing `scratchpad.md`, deterministic test reports (JUnit XML / JSON), and host session metadata only.
- **Truthful model identity:** reports executed model only when recorded in authoritative host session events; never infers executed model from a configured default lane. In Stage 2, the host adapter must construct `modelEvidence` directly from live `dsh-session` events rather than accepting caller-supplied labels.
- **Workspace confinement & limits:** resolves both workspace root and target via `realpath`, rejects lexical traversal and symlink/junction escapes, opens once with `O_NOFOLLOW` on POSIX, and reads through the file handle with a 256 KiB cap. Threat model: prevents accidental traversal, workspace-escaping links, and oversized/non-regular reads under the local developer user account. Residual limit: `realpath`-before-`open` cannot eliminate concurrent same-UID ancestor directory swaps on Windows (where `O_NOFOLLOW` is unavailable) or across parent directories; this is an application-level guard, not an OS sandbox.

## Verified ZadLoop 0.11.2 host API feasibility

Inspected read-only from the installed ZadLoop Desktop `0.11.2` runtime (`resources/app.asar.unpacked/runtime/node_modules/@deepseek-ai/`):

| Capability | Verified package / API | Stage 2 feasibility |
| --- | --- | --- |
| **Collapsible right sidebar** | `@deepseek-ai/dsh-client-ui-sidebar-right` (`ctx.sidebarRightTabs.register({ id, kind, priority: 'extension', title, guide })` + `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id }, Body)`) | **Confirmed supported** — exact same public extension path used by `@deepseek-ai/dsh-client-ui-sidebar-browser` and `@deepseek-ai/dsh-client-ui-sidebar-documentpreview`. |
| **Active session & workspace path** | `@deepseek-ai/dsh-session` (`ctx.sessions.get(id)`, `ctx.sessions.list()`, `cwd`, `parentSession`, `origin`) + `@deepseek-ai/dsh-working-directory` (`ctx.workingDirectory.get(session)`) | **Confirmed supported** — already used by `zadloop-gemini-cli-provider/src/adapter.js`. |
| **Session model / subagent events** | `@deepseek-ai/dsh-session` typed events (`assistant/message`, `model/selection`, `delegation/model-choice`, `subagent/model-selection-policy`) | **Partially confirmed** — event types exist in `dsh-session/lib/index.js`; Stage 2 must verify exact runtime payload fields on an authorized nonconfidential test session and fall back to `Unknown` when absent. |
| **Host-to-client read-only transport** | `ctx.connection.fetch.register({ path: '/api/...', methods: ['GET'] })` | **Confirmed supported** — already proven in `usage-panel/index.js`. |

## Offline verification

```sh
npm --prefix zadloop-workflow-dashboard test
```

Runs deterministic offline tests against temporary fixtures (no ZadLoop host, no network, zero model calls).
