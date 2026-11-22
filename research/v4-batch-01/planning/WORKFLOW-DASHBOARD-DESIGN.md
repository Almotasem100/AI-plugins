# V4 — Read-only Workflow Dashboard (approved design direction; implementation not yet authorized)

## Owner-selected product direction

**Decision:** Expand the proposed *small Test Evidence Viewer* into a **read-only, milestone-based Workflow Dashboard** integrated as a panel **inside the currently selected harness**, with testing details as one expandable portion, not its sole purpose. The owner explicitly rejected live AI-driven supervision as a cost model. **Zero additional AI/model calls** for dashboard operation is a hard MVP acceptance constraint. The dashboard should not need its own model, periodically ask the orchestrator for updates, or inject routine update prompts into the model's context.

User preferences: research BOTH existing browser-verification vs Playwright MCP/CLI and existing static analysis vs ast-grep **before** installing tools; incident-derived review checks remain advisory; no live status streaming, dashboard workflow controls or autonomous orchestrator. No tool/MCP/plugin installation or implementation is authorized by this planning record.

## Smallest intended architecture

```text
existing host session/task metadata + normal workflow/scratchpad + actual test/review artifacts
    -> small deterministic local, read-only adapter
    -> harness-integrated GUI panel
```

**Reuse; do not duplicate workflow state.** The existing `AI-skills/skills/work-closeout/templates/scratchpad.md` already has stage, completed work, decisions, blockers, verification and next action, updated at meaningful transitions. Reference authoritative source artifacts, not invented event history. Use host native session/assignment events and relevant existing records only when APIs expose them. The viewer must **not** require a separate database, event bus, daemon, cloud server, full transcript, schema migration or new mandatory workflow file. A tiny derived in-memory representation for rendering is fine; it is not a second authority.

## MVP display (no artificial stages)

1. **Work item**: actual item, Full Feature or Change/Bug *only when known*, relevant current outcomes/slices and last recorded milestone. No universal fixed stage sequence; don't turn optional steps into gates.
2. **Milestones**: Pending / Started (last reported) / Completed **with evidence** / Blocked / Skipped / Unknown. Distinguish unknown stale status from live process state; never infer that a worker is currently active because the prior record says started.
3. **Assignment/participant**: actual responsible participant, configured lane and model **only when assignment/session evidence supplies the actual identity**; never infer executed model from default configured lane.
4. **Verification**: Passed / Failed / Skipped / Blocked / Not Run (and Unknown when evidence missing), exact tested commit/build when available, existing reports/screenshots/logs and their local authorized references. Test report parsers are deterministic and source-bound; missing results never become green.
5. **Review and blockers**: meaningful open findings/owner decisions, blocked reason and resume pointer when these exist in existing artifacts.
6. **Expandable details**: existing FD, LLD, plan, QA, diff, test and review evidence pointers, with careful path/access limits. Only locally available authorized items; no secret/customer-data exfiltration.

### Truthfulness and incremental cost
- **Target: zero *additional* model calls**. Reading files, parsing XML/JSON/JUnit, rendering a panel, and reacting to an already emitted host event require no model calls. Existing model steps still use their normal tokens; the panel must not increase their frequency or ask for summaries. Existing work-state writes by the orchestrator must not be expanded solely to feed the panel. An occasional manual refresh using ordinary host code is fine.
- **Do not promise measured zero tokens yet**: the above is a design constraint that a later proof must validate. If existing host and artifact evidence are insufficient, display Unknown / not available; **do not** call a model to fill gaps. If the result is not useful without model supervision, recommend reducing scope or cancelling the plugin.
- No continual AI polling, post-step summaries, background workers, screenshots generated solely for decoration, or per-token activity streaming.
- Privacy: local only, read-only file and host access restricted to approved workspace, no credential/log-content leaks into UI or telemetry, no automatic connection to company systems. Treat apparently read-only plugin access as dependent on real host/OS permissions; don't imply sandbox enforcement without verification.

## Platform feasibility is the only serious open engineering risk
- Existing **OpenCode** subscription-usage panel uses OpenCode Desktop's experimental GUI API; documented tested baseline is Desktop 2.3.0. Existing **ZadLoop** subscription usage is a different host/client extension. These demonstrate local panels but **not** a proven workflow panel, generic file-reading ability, or reliable cross-host event model.
- Inspect current installed versions and real host APIs before selecting UI entrypoints/event hooks. Choose **one pilot host** for first proof based on actual accessible capabilities and owner's current use; independent plugin package(s) must remain separately installable if both hosts later supported. No shared runtime dependency or forced simultaneous port.
- Determine actual sources for task/step status, assignment start/end, error/cancel, and test evidence. Record what is provable and what remains Unknown. Prefer existing metadata over adding model-authored structured updates. Some phase boundaries may only be identifiable in the scratchpad; no fabricated real-time state.
- Check panel opening/closing, stale state after switching sessions/projects, refreshing, handling absent/stale/malformed reports, output-size and file path constraints, UI-version stability, Windows file access, and host permissions using authorized nonconfidential fixtures.

## Small staged feasibility and acceptance plan — for a **later separately authorized executor**
1. Baseline audit: compare existing GUI usage panels and selected host API/events to sources; identify feature overlap and minimum evidence sources; challenge if built-in host already offers equivalent.
2. Evidence feasibility **without a GUI**: a deterministic read-only fixture adapter that parses one existing scratchpad-like state, one sample test report, and assignment metadata only where available. Test unknown/stale/blocked, failed vs skipped, source path identity; no model calls.
3. UI pilot in one actual host with the smallest panel: stage + last known state, participant if known, blockers, test summary and evidence pointers. Label the source and timestamp/last update; no speculative live activity.
4. Validate plugin lifecycle, host-version compatibility and permission boundaries with offline tests and authorized installed-host smoke; use nonconfidential sample project; record measured **additional model calls = 0**, and distinguish that from unmeasured token overhead of ordinary engineering.
5. Independent reviewer challenges accuracy, complexity, maintainability and security. If reliable mapping requires extra AI supervision or duplicative persistent state, **push back and reduce/stop**, do not hack around the constraint.

## Planned repo ownership and handoff
- **AI-plugins:** owns host-specific GUI and adapter implementation, package boundaries, tests and documented compatibility.
- **AI-skills:** owns existing milestone/evidence semantics and closeout feedback, **not** dashboard rendering. Don't edit workflow rules merely for prettier UI; only make narrowly proven corrections to existing capability under separate implementation authority.
- **HDC-documents:** owns HDC-specific evidence/permissions. No HDC policy/deployment change from this UI research.
- The owner wants the **same independent executor/reviewer (Luna or chosen model)** to challenge and implement the approved workflow refinements **and** plugin work as coordinated but separately scoped repo changes, *after* explicit execution authorization. One mutation owner per change; independent review preserved. No master merge, installation, publishing, or production deployment authorized.

## Remaining questions
No new owner-level decision is required before feasibility research. Host for the first pilot, exact source/file formats, UI API reachability and lifecycle are **technical investigations**, not reasons for another speculative user interview. If both hosts prove similarly viable and selection affects install scope, ask the owner once with a concrete recommendation. Confirm the *actual* source of model assignment from recorded execution before displaying it. Dashboard remains **read-only with no buttons for approve/pause/resume** in MVP.
