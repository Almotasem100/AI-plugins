# AI workflow across three repos — discussion scratchpad

Working notes, not a roadmap or approval to build. Keep local and uncommitted while we decide what stays.
Scope: workflow, skills, developer tooling, and harness UX. No HDC application backlog, private task inputs,
vendored upstream TODOs, or synthetic test examples. Read the sibling repos without changing them.

## What we see now

- **AI-skills** owns portable workflow semantics and skills. **HDC-documents** owns HDC policy, current state,
  decisions, and acceptance evidence. **AI-plugins** owns concrete harness capabilities. Keep those boundaries.
- The weak point is handoff continuity: a new worker must reconstruct the revision, what ran, and what's open.
  PR #1 illustrates that distinction: passing CI, a live check, and owner confirmation had different sources.
  [Example](../docs/experiments/work-evidence.md).
- Discussion candidate: strengthen the implement → review handoff using the existing working record. Pass the
  exact revision, actual test result, and unverified items. Don't add a second tracker or orchestrator.
- Discussion candidate: a read-only OpenCode Workflow tab, with connected stages, live worker status, planned
  versus actual model, and links to worker sessions. Prove one real handoff before expanding. A finished worker
  doesn't mean accepted work. Prefer no manual upkeep. [Existing note](../docs/future-work.md).
- `/ticket-status` proved a structured, sourced chat summary, not live tracking. Recommendation: leave the
  untracked command out of the branch; don't remove it before the owner decides. Keep the evidence example.
- Next discussion: compare the candidates below, then decide what to promote, keep parked, or discard. No
  implementation or HDC-documents edits in this discussion.

## AI-plugins

- [Future work](../docs/future-work.md): live Workflow tab. Automatic dispatch, Jira integration, and a ZadLoop
  port are deferred; no HDC-documents changes for the prototype.
- [OpenCode Gemini README](../opencode-gemini-cli-provider/README.md#future-tasks) and
  [ZadLoop Gemini README](../zadloop-gemini-cli-provider/README.md#future-tasks): host-controlled Gemini tool bridge
  (requires real permission enforcement, session isolation, correlation, and cancellation); genuine
  mid-request steering without cancelling or replacing the turn.
- [Upgrade plan](../docs/plans/plugin-upgrades.md): consider porting the ZadLoop stale/last-checked refresh UX
  to OpenCode after feedback. Revisit doctor packaging only before adding another host or probe.
- Related limits, **not promised features**: OpenCode ChatGPT token-sharing support needs more evidence;
  ZadLoop current-session account selection was out of scope, and multi-account selection was not needed.
  [OpenCode verification record](../opencode-usage-panel/HANDOFF.md) ·
  [ZadLoop implementation record](../usage-panel/IMPLEMENTATION.md).
- Verification follow-ups, **not enhancements**: live updated ZadLoop refresh; real Gemini CLI doctor; Linux
  checks for the upgrade branch; separate OpenCode Desktop refresh, keyboard, light mode and failure-path checks;
  visual theme verification. [Plugin plan](../docs/plans/plugin-upgrades.md) ·
  [OpenCode usage record](../opencode-usage-panel/HANDOFF.md) ·
  [Themes README](../opencode-desktop-themes/README.md).
- No older standalone future log found in the current checkout or Markdown paths in reachable local Git history.
  The older Gemini entries are real: commit `3120d76` added both README sections. The plan and handoffs are
  additional sources, not competing repo-wide backlogs.

## AI-skills

Sources: [roadmap](../../AI-skills/docs/roadmap.md),
[future ideas](../../AI-skills/docs/records/future-ideas.md),
[decision record](../../AI-skills/docs/records/decisions.md), and
[friction review](../../AI-skills/docs/records/friction-log-review.md).

- **Recorded next steps, not deferred:** refresh installed copies, verify loading in a fresh session, decide
  whether three OpenCode host rules belong in the shared instructions, switch the Gemini lane through OpenCode
  without changing the chosen model or permissions and verify the first real dispatch, collect friction from real tickets.
- **Explicitly deferred:** general native-worker routing; new ZadLoop integration; upstreaming the Gemini relay
  overlay; standalone installer; secret-free fleet and lane export examples.
- **Team visibility:** Hermes-inspired shared workspace; small evidence/task timeline; external-delegation viewer
  / orchestration control center; inspect or address a worker; shared discussion with targeted mentions and
  distinct awareness versus response requests. Compare coordinator relay, direct exchange, and a hybrid.
- **Review:** focused multi-reviewer debate; compare scoped reviewers with one stronger reviewer using findings,
  misses, false positives, elapsed time, and total usage.
- **Event-driven research:** lightweight outer router with isolated task workers; event filtering and thread
  subscriptions; linked recall with short inline context and retrievable originals; asynchronous execution
  and appropriate notifications; separate compute, persistent state, and execution environments; bounded
  external progress watchdog. Cloud/cross-device concepts are not current priorities.
- **Workflow tooling:** PR/CI supervisor; acceptance-evidence gap spotter; capability-aware routing and
  OpenCode route-observability/override guards; context/continuity diagnostics; flight recorder and blocker
  notifications; Creator Mode-style OpenCode developer experience; interactive plan review or onboarding
  (Plannotator / OpenCode GUI). Keep a delegation receipt (actual route/model, fallback, result pointer) as a
  possible small route-observability experiment from our discussion.
- **Integrations:** Figma, SonarQube, ticket tracker, Git host/PR, and version-matched official documentation
  lookup (Context7 is a candidate). Read-only first; no implicit installation or write authority.
- **New-project readiness:** inception checklist; architecture/ADR starter; thin vertical slice; API
  contract/compatibility checks; risk-based tests and fixtures; minimal CI/CD/environment bootstrap;
  security/privacy baseline; observability/fault recovery; UX state/accessibility coverage; dependency docs
  lookup. Scaffolding examples are research inputs, not a wholesale skill import.
- **Personal UX:** themes/accent presets; optional ambient sounds; small activity HUD; session organizer/pinned
  workspaces; completion animation; focus layout; personal project switchboard. Revisit T3 Code only for a
  concrete gap; ZadLoop remains an option for Creator Mode and UX, not a proposed migration.
- **Older conditional follow-ups:** standalone headless `describe-pr` CLI only if the skill proves too slow;
  revisit historical Windows relay near-timeout failures only if they block a real update; investigate Gemini
  automatic skill selection only with current host/version and invocation evidence.

## HDC-documents — engineering process only

- [Current plan §3b F](../../HDC/HDC-documents/HDC_Modernization_Development_Plan.md#f-workflow--process):
  **F2** Jenkins integration; **F3** Jenkins/E2E integration is owner-deferred (an optional local synthetic
  browser suite already exists); **F4** DEV role-account/fixture coverage for real permission checks;
  **F6** obtain missing design states before coding and consider Figma variable export instead of manual
  color transcription. These are HDC-specific process/verification items, not plugin commitments.
- [Retired automation handoff](../../HDC/HDC-documents/_retired-docs/automation/Automation_Planning_Handoff.md)
  and [plan history](../../HDC/HDC-documents/HDC_Plan_History.md): historical candidates include a Spec Kit
  comparison against the existing intake/design workflow, SonarQube-assisted review/fix, Git-host/Copilot
  review follow-up, team PR standards (`pr-standard.md`), and installer/native-host trials. Standing Spec Kit
  adoption was withdrawn. These are provenance, not current HDC instructions; overlaps above are intentional.
  The old code-map idea was replaced by `url-map`; PR description and LLD skills already exist.

## Ideas from this conversation, not previously saved backlogs

- A local delivery-evidence inspector or endpoint migration explorer using existing URL-map and JSON-compare
  outputs; don't rewrite those tools. The evidence view and live Workflow tab solve related but different needs.
- Donald Duck: remember position with Reset. Themes: polish Midnight Workspace in the app before adding a palette.
  These are suggestions, not selected work.
