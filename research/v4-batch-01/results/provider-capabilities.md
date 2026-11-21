# Provider and delegation capability evidence

## Revision and evidence level

- Repository: `Almotasem100/AI-plugins`
- Research branch starting tip: `8ecc9127b613117e1a5150a19a56131ee5939981`
- Fetched `master` baseline: `b39cf68e7d902b5aebcf72b11c61affeb2ab4c76` (merge base); initial tree had only this experiment's `EXECUTION.md` delta.
- Current provider claims below are from source/docs and fake-process tests, not a live harness or Gemini model run in this repository.

## Capability matrix

| Capability | OpenCode Gemini CLI provider | ZadLoop Gemini CLI provider | AI-skills Gemini CLI relay |
|---|---|---|---|
| Text | Documented `stream-json`; each request launches Gemini CLI. Fake-CLI tests cover deltas, final result, and errors. | Documented `stream-json`; each call launches Gemini CLI. Offline fake-process tests cover streaming and terminal failures. | Overlay documents a CLI relay invocation and structured result; overlay tests use a fake CLI. This batch did not dispatch the CLI relay. |
| Image | Documents PNG/JPEG/WebP/GIF via ACP. Images require compatible Gemini CLI; fake ACP tests exercise image transport. | Documents the same image MIME types via ACP, subject to host attachment normalization/limits. Delegation tools are text-only. Fake ACP tests run against a stub. | No image capability for the relay was established from the source inspected; do not route image-dependent work through it without separate evidence. |
| Host-controlled tool bridge | Not implemented. Provider transcript can render host tool calls/results as text, but that is not a host-executed tool bridge. README notes native and ambient tool paths can bypass OpenCode permissions. | Not implemented. Host interfaces make a bridge plausible, not proven; forwarding Gemini actions as host calls without actual host execution/results would misrepresent approval. | CLI executes its own tool loop; no OpenCode host approval integration is claimed by this relay. |
| Gemini-native tools | Enabled by Gemini CLI's own loop. Plugin starts it with `--approval-mode=yolo`; OpenCode tool permissions/approval UI do not govern those actions. | Enabled by Gemini CLI's own loop under the OS user. ZadLoop per-tool approvals/workspace sandbox UI do not govern them. | Relay supports approval modes; default `auto_edit` auto-approves edit tools, not every shell action. `yolo` is explicit opt-in. This is CLI approval behavior, not OS isolation. |
| Enforced read-only | Not established; YOLO native loop remains outside host controls. | Not established; YOLO native loop remains outside host controls. | No enforced read-only promise. `plan` may be downgraded by CLI settings. Use OS-enforced isolation if read-only must be enforceable. |
| Steering | Queued OpenCode message is not forwarded into an active Gemini turn; ACP prompt aborts rather than appends. | No mid-stream message channel; a second ACP prompt aborts/replaces the active one, not steering. | No steering result was tested in this batch; do not infer it from session resume. |
| Session continuity | Each OpenCode model request starts a new Gemini invocation; provider does not preserve a persistent CLI session. | Each call starts a new CLI process; one-shot delegation has no parent transcript inheritance or follow-up. | Supports session resume selectors; docs require comparing the returned session ID before claiming continuity. Fresh output directories preserve prior evidence. |
| Cancellation/cleanup | Cancels/timeouts request process-tree termination; cleanup is bounded and Windows descendant termination is not guaranteed. Fake subprocess tests exercise cancellation and cleanup errors. | Cancellation or a closed consumer terminates the process; fake-process tests cover cancellation and cleanup failure. Live host teardown remains unverified. | Relay has timeout/abort/recovery semantics in the overlay; fake-CLI tests do not establish live Windows/Gemini cancellation here. |
| Errors/partial output | Safe classifications for startup/auth/quota/turn-limit/protocol/cancel/process errors; partial text followed by terminal failure is not success. ACP may report a hidden underlying failure as `end_turn`. | Safe error classifications; partial terminal failures are errors. ACP may hide token exhaustion/safety failures behind `end_turn`. | Overlay calls out process/session errors and fake-CLI contract coverage; no live request/error was made. |
| Model/effort | Default alias to Gemini Flash; model catalog IDs can be added. OpenCode effort variants are not translated to Gemini CLI thinking configuration. | Flash and Pro Preview plus Flash alias and one-shot model-specific subagents. ZadLoop reasoning effort is not translated. | Optional explicit model or CLI Auto/default; approval mode and timeout are documented. Auth/catalog/usage remain unknown from version-only discovery. |
| Token/quota evidence | Provider returns undefined token usage. Quota/rate-limit errors can be classified in text mode; ACP may hide some causes. | Does not report token usage; quota/rate-limit classification exists where evidence permits, but ACP can hide underlying cause. | Relay does not establish model/token/quota availability from `--version`; no quota telemetry was collected here. |

## Source evidence

- OpenCode provider behavior: `opencode-gemini-cli-provider/README.md` sections **Use**, **Effort and variants**, **Important behavior**, **Streaming and errors**, and **Steering and host tools**; request mapping and undefined usage in `src/provider.js`; fake CLI/ACP tests in `test/gemini.test.js`, `test/provider.test.js`, and `test/tool-handoff-experiment.test.js`.
- ZadLoop behavior: `zadloop-gemini-cli-provider/README.md` sections **Important behavior**, **Host tool bridge and steering**, **Host compatibility**, and **Verify**; adapter/ACP code in `src/adapter.js` and `src/acp.js`; fake process tests in `test/adapter.test.js` and `test/smoke.js`.
- AI-skills relay evidence: `AI-skills/README.md` describes external CLI relays; `AI-skills/overlays/gemini-delegate/README.md` describes the base-pinned Gemini contribution and fake-CLI-only verification. `changes.patch` documents approval-mode mapping, the `auto_edit` default, no enforced read-only guarantee, session resume, and limits of discovery. The optional delegation profile was not loaded and no relay was dispatched.

## Interpretation boundary

Documented/implemented transport support is not equivalent to effective permission containment. Fake-process tests validate adapter behavior against controlled doubles; they do not prove a real OpenCode/ZadLoop installation, installed Gemini CLI version, ACP behavior, permissions, auth, cancellation, or quota.
