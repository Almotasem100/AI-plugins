# V4 Independent Technical Review & Implementation Challenge — AI-plugins

**Status:** Independent review of V4 candidates, Workflow Dashboard feasibility, and legacy `feat/plugin-upgrades` complete; **stopped before implementation**. No production plugin files, `master`, `feat/plugin-upgrades`, or installed hosts were modified.

## 1. Baselines inspected

- `research/v4-composability-batch-01`: `288acb1` (clean, synced with `origin`).
- `origin/master`: `b39cf68`.
- `origin/feat/plugin-upgrades`: `3403595` (2 commits ahead of `b39cf68`: `273982d` functional changes, `3403595` discussion/recording). Inspected via `git show`/`git diff` without checkout or merge.
- Reconciled stale "Test Evidence Viewer only" wording in `research/v4-batch-01/planning/HARNESS-RESEARCH-FOLLOWUP.md` to match `WORKFLOW-DASHBOARD-DESIGN.md`.

## 2. Independent challenge of legacy `feat/plugin-upgrades` (challenging `PLUGIN-UPGRADES-BRANCH-TRIAGE.md`)

| Legacy item (commits `273982d`, `3403595`) | Triage preliminary disposition | Independent review & challenge | Final recommendation |
| --- | --- | --- | --- |
| **ZadLoop usage-panel refresh** (`usage-panel/client.js`, `test/client.test.mjs`, `README.md`) | Carry as ready-to-validate candidate | **Agree, with 1 minor source catch.** Diff in `usage-panel/client.js` (+85 lines) is clean, zero-model-call, no storage/polling, strict `sanitizeSnapshot` validation (`percent` in `[0,100]`, valid ISO `resetsAt` or `null`, drops unknown fields), preserves prior snapshot with `Last checked` and `Stale`, and clears on close. **Catch:** `usage-panel/locale/en.json` was not updated with `lastChecked`/`stale` (falls back to inline `messages`). | **Optional independent slice** (not a Dashboard prerequisite). Port selectively (~95 prod / ~230 test lines, including `locale/en.json` sync) + run `npm --prefix usage-panel test` and live ZadLoop smoke when authorized. |
| **Gemini CLI standalone `doctor`** (`opencode-` and `zadloop-gemini-cli-provider/src/doctor.js`, `test/doctor.test.js`, `test/doctor-parity.test.mjs`, `CONTRIBUTING.md`) | Carry as conditional candidate | **Challenge harder -> Recommend DEFER / REJECT AS-IS.** Security hygiene is solid (fixed messages, no YOLO, no prompt/session, `shell: false`, bounded cleanup), **but**: (1) **1,472 lines** (466 prod + 270 test duplicated verbatim across 2 packages — 4×–6× over its own 220–360 line plan estimate); (2) **real Windows bug at `doctor.js:55`**: `isFileOutside()` only catches `ENOENT`/`EACCES`/`ENOTDIR` and **throws on `EPERM`**, aborting PATH walk on restricted PATH entries; (3) **fragile Windows launcher hardcode at `doctor.js:97`**: assumes `node_modules/@google/gemini-cli/bundle/gemini.js` for `.cmd`/`.bat`; (4) checks only shell PATH `--version` + ACP `initialize`, not host PATH, auth, quota, or model availability. | **Defer / Reject as-is.** Simplest alternative if a probe is ever needed: a single ~60-line repo-root script (no dual-package duplication), or `gemini --version`. |
| **PR #1 work evidence** (`docs/experiments/work-evidence.md`) | Preserve idea / reuse as fixture | **Agree.** Good provenance illustration; do not copy a dated PR #1 retrospective into `master` docs or canonical workflow rules. | **Keep as reference/fixture idea only** (0 production lines). |
| **Old Live Workflow tab** (`docs/future-work.md`, `active-work/scratchpad.md`) | Superseded; fold in novel value | **Agree.** Superseded by `WORKFLOW-DASHBOARD-DESIGN.md` (read-only, milestone-based, zero additional model calls). Retain only two test cases for Dashboard pilot: (a) source-backed planned-vs-actual model display; (b) one implementer→reviewer handoff showing finished worker ≠ passed review. Reject live streaming and OpenCode-only lock-in. | **Superseded** (folded into Dashboard Stage 2 acceptance cases). |
| **`/ticket-status` command** (`.opencode/commands/ticket-status.md`) | Do not adopt for MVP | **Agree.** Consumes model tokens and duplicates normal status questions + zero-model-call dashboard. | **Reject for MVP.** |
| **`active-work/scratchpad.md`**, host-controlled tool bridge, mid-request steering, OpenCode refresh parity, broad brainstorm | Do not port / Defer | **Agree.** `active-work/scratchpad.md` itself states "Keep local and uncommitted" yet was committed in `3403595`. Tool bridge/steering lack permission isolation proof. | **Do not port / Defer.** |

**Branch handling:** Do NOT merge or cherry-pick `feat/plugin-upgrades` wholesale; do NOT delete it until desired optional slices land and owner explicitly authorizes retirement.

## 3. V4 provider candidates (`P-09`..`P-12`) — concrete source findings

| ID | Candidate | Disposition | Source-verified evidence | Smallest delta |
| --- | --- | --- | --- | --- |
| **P-09 / I-10** | Terminal-status honesty in Gemini providers | **Useful minimal compatible (real defects found)** | In `opencode-gemini-cli-provider/src/gemini.js`: (1) lines `556-580` return `""` as nominal success when ACP `session/prompt` ends with `stopReason: "end_turn"` and no text, whereas `zadloop-gemini-cli-provider/src/acp.js:148` properly throws `"Gemini CLI ACP returned no response text."`; (2) line `535` discards structured JSON-RPC `message.error` classification (`zadloop-gemini-cli-provider/src/acp.js:103` classifies via `geminiFailure`); (3) line `266` (`isExecutable`) throws on `EPERM` instead of skipping unreadable PATH entries (directly reproduced in sandbox test run below). | `opencode-gemini-cli-provider/src/gemini.js` + `test/gemini.test.js` (~35–55 lines total). |
| **P-10** | Tool invocation ergonomics | **Investigate / Defer** | No concrete user-reported misrouting case yet. | 0 lines. |
| **P-11** | Cost telemetry | **Defer** | Gemini CLI does not expose trustworthy token/quota metadata; unknown must stay unknown. | 0 lines. |
| **P-12** | Permissions / YOLO boundary | **Preserve** | Both providers run `--approval-mode=yolo` outside host approval UI; never claim read-only enforcement or add unverified tool bridge. | 0 lines. |

## 4. Workflow Dashboard technical feasibility (`WORKFLOW-DASHBOARD-DESIGN.md`)

**What existing `AI-plugins` code proves:**
- **Zero additional AI/model calls is feasible:** Both `opencode-usage-panel` (Node server RPC via `ctx.rpc.register` → `gui-experimental.cjs` SolidJS/DOM popover) and `usage-panel` (Cordis Node HTTP route `/api/usage-panel` → React portal `client.js`) prove deterministic server-side local reads rendered in-harness without calling any model.

**What is NOT yet proven (must be resolved in Stage 1 before UI code):**
1. **Host APIs for workspace & session metadata:** `opencode-usage-panel` only uses `ctx.integration`, `ctx.rpc`, and `Slot` at `session.header` (Desktop 2.3.0). Neither host plugin in this repo currently proves: (a) a dedicated sidebar/tab slot, (b) server-side access to the active session's workspace path, or (c) live/historical subagent participant & executed model IDs.
2. **Actual participant/model identity:** `scratchpad.md` does not reliably record executed model IDs, and default lane config ≠ executed model. Unless the chosen pilot host's session metadata exposes actual executed model IDs, the dashboard **must** display `Unknown`.
3. **Deterministic parsing limits:** `scratchpad.md` is human/agent-edited Markdown; test reports vary (TAP/JUnit/JSON). Parser must treat missing/unparseable fields as `Unknown` or `Stale`, never infer green or invoke a model.

**Recommended staged implementation plan (only when authorized):**
- **Stage 1 — Feasibility audit + headless deterministic adapter (no GUI):** Inspect installed pilot host (OpenCode Desktop or ZadLoop) APIs; build & test a tiny read-only parser for `scratchpad.md` + sample test report + optional host session metadata (3–4 files, ~150–220 lines). **Stop/push back** if host APIs cannot expose workspace/session cleanly without model calls.
- **Stage 2 — Minimal read-only UI pilot (single host):** Only after Stage 1 succeeds: smallest panel showing work item, last-known milestones, participant/model (only when proven), blockers, verification summary + expandable evidence pointers, source + timestamp, 0 additional model calls (4–6 files, ~200–300 lines).
- **Simplest alternative:** Run **P-09 bug fix only** (~35–55 lines) now, and start Dashboard Stage 1 once the pilot host version and API surface are confirmed on the workstation.

## 5. Checks run & observed limits

- `npm --prefix AI-plugins test`:
  - `donald-duck`: passed.
  - `usage-panel`: **18/18 passed**.
  - `opencode-usage-panel`: **21/21 passed**.
  - `opencode-gemini-cli-provider`: **14 passed, 32 failed** — all 32 failures threw `EPERM: operation not permitted, access 'C:\Users\malmotas\AppData\Roaming\Antigravity\bin\node.exe'` at `src/gemini.js:266` (`isExecutable`), exposing the real `EPERM` PATH-walk defect.
  - `zadloop-gemini-cli-provider` and `opencode-desktop-themes` did not run because `&&` stopped at `opencode-gemini-cli-provider`.
- No installed host, live Gemini CLI, or legacy branch test suite was executed.
