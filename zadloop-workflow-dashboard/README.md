# ZadLoop Workflow Dashboard

A read-only, milestone-based collapsible right-sidebar tab for **ZadLoop Desktop (`0.11.2`)**, alongside the existing Browser and Workspace Files sidebars. Displays the active work item, workflow kind, last-known stage/status, verified executed model (only when backed by a genuine `dsh-session` `assistant/message` event), blockers, verification outcomes, and expandable evidence references with **zero additional AI/model calls**.

## Design invariants

- **Read-only:** never edits scratchpads, workflow files, or host state, and exposes no control/approval/dispatch actions.
- **Zero additional AI/model calls:** purely deterministic local file/metadata parsing; missing or unparseable evidence renders `Unknown`.
- **No polling or background daemon:** fetches `GET /api/workflow-dashboard?sessionId=<id>` only on sidebar open, session switch, or manual Refresh.
- **No duplicate workflow state:** reads existing `active-work/scratchpad.md` (or `scratchpad.md`) and existing JUnit XML / JSON test reports inside the active session's workspace.
- **Truthful model identity:** `index.js` inspects `session.snapshotEvents()` for genuine `assistant/message` events (`data.message.source.model` + `seq`). A `model/selection` event populates `configuredLane` only; without an executed `assistant/message`, `executedModel` renders `Unknown`.
- **Session isolation & host boundary:** `GET /api/workflow-dashboard` fails closed on missing, malformed, unknown, or mismatched `sessionId` and **never** falls back to `workingDirectory.defaultDirectory`. The client also rejects responses whose `sessionId` does not match the active session. **Host boundary note:** in ZadLoop `0.11.2`, `ctx.connection.fetch.register` sits behind the host's authenticated local browser-session fence, but does not expose per-tab session authorization; a caller-provided `sessionId` is validated against `ctx.sessions.get(sessionId)` and its bound workspace only.
- **Milestone presentation limits:** the sidebar displays a compact milestone list derived strictly from existing scratchpad entries (completed bullets `✓`, last-reported stage `●`, next action `○`) without introducing fixed workflow stages, new files, or invented progress. When those sections are absent, it displays `No milestones recorded (Unknown).`.
- **Workspace confinement & limits:** resolves both workspace root and target via `realpath`, rejects lexical traversal and symlink/junction escapes, opens once with `O_NOFOLLOW` on POSIX, and reads through the file handle with a 256 KiB cap. Threat model: prevents accidental traversal, workspace-escaping links, and oversized/non-regular reads under the local developer user account. Residual limit: `realpath`-before-`open` cannot eliminate concurrent same-UID ancestor directory swaps on Windows (where `O_NOFOLLOW` is unavailable) or across parent directories; this is an application-level guard, not an OS sandbox.

## Target harness & compatibility

- **Target harness:** ZadLoop Desktop `0.11.2` (runtime APIs verified read-only against installed `0.11.2` packages: `@deepseek-ai/dsh-client-ui-sidebar-right`, `@deepseek-ai/dsh-client-locale`, `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-working-directory`).
- **Host integration:** `cordis.patch.yml` injects `[connection, sessions, workingDirectory]` and registers `GET /api/workflow-dashboard` (`cache-control: no-store`).
- **Client integration:** registers right-sidebar tab `@local/zadloop-workflow-dashboard/panel` (`kind: 'workflow-dashboard'`, `priority: 'extension'`) via `ctx.sidebarRightTabs.register(...)` and `sidebar.right.pane.tab` slot.
- **Permissions / credentials:** read-only local workspace file reads and in-process `dsh-session` inspection; requires no credentials, tokens, or external network access.

## Install / remove (for authorized profile testing only)

Install from this package directory in an authorized ZadLoop test profile using the same local-bundle mechanism as `usage-panel` (`dsh.bundle` + `dsh.client`), then reload the profile. Remove by uninstalling `@local/zadloop-workflow-dashboard` from the profile and reloading; disabling or removing disposes the HTTP route, locale dictionary, sidebar tab type, and slot registration.

## Verification

```sh
npm --prefix zadloop-workflow-dashboard test
```

Runs offline tests covering the Stage 1 evidence adapter (`test/adapter.test.mjs`), host route & `dsh-session` event extraction (`test/host.test.mjs`), and right-sidebar client lifecycle/session-switching/cleanup (`test/client.test.mjs`). Offline suites do not establish live ZadLoop Desktop rendering or live-session event payloads; an authorized live ZadLoop smoke test remains separate.
