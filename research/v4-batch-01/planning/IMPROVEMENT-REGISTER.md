# V4 improvement register — AI-plugins (planning only)

See [harness-engineering and skills/testing follow-up](HARNESS-RESEARCH-FOLLOWUP.md) for researched incremental enhancements, source limits, and deferred MCP/plugin choices. No implementation or installations are authorized by that log.

See [five-article audit and executor queue](FIVE-ARTICLE-AUDIT.md) for source-based recommendations, concrete candidate deltas, non-duplicates, reviewer pushback rules, and new external discovery. This register preserves the broader V3 baseline; the linked audit is the actionable research handoff.

> Research proposals, **not** live plugin instructions or an approved development backlog. Each top-level plugin stays independently installable per `CONTRIBUTING.md`. No code, permission, model, authentication, deployment, installation or host configuration change is authorized by this register.

## Architectural boundaries

- AI-skills owns workflow outcomes and routing semantics; AI-plugins owns host-specific implementation, tool permissions, failure/cancellation reporting and documented capabilities. HDC owns its environment rules.
- Preserve current Gemini integration: it solves a real restricted-workstation requirement and supports choosing Gemini as a native harness model or subagent. **Do not turn this into OpenCode-vs-ZadLoop benchmarking** or a plan to remove plugins.
- All candidates below require review of present source, package README, existing fake-host test evidence and the **actual connected runtime** where allowed. No change is approved merely because it's recorded here.
- The implementing model is empowered to challenge, narrow, defer or propose a more comprehensive solution based on evidence, but must obtain owner approval before material scope/permission changes.

## Findings and candidates

| ID | Disposition | Current evidence | Potential improvement / gate |
| --- | --- | --- | --- |
| P-01 | **Preserve** | Separate independent packages for OpenCode and ZadLoop; companion plugins meet different host APIs (`README.md`, `CONTRIBUTING.md`). | Do not centralize host adapter code without a demonstrated maintained interface and simpler migration. |
| P-02 | **Preserve** | Both Gemini providers support text and selected image attachments (with installed CLI/ACP compatibility constraints). The feature addresses user demand. | Keep and test in actual host only when changing behavior; no need to rerun host comparisons. |
| P-03 | **Important boundary / investigate** | Both Gemini provider integrations launch CLI native tool loop with `--approval-mode=yolo`, outside host approval/permission UI. No enforced read-only or host-controlled tool bridge is proven. | Never route tasks requiring enforced host permission or OS read-only solely by model name. For any proposed fix, first prove permission isolation, cancellation and no bypass. **Do not enable tool bridge by default.** |
| P-04 | **Candidate / evidence needed** | Capability information is spread across READMEs, route docs and effective runtime, and installed support can differ from source claims. | Investigate a small machine-/agent-readable capability summary or query **only if** workflow selection suffers a demonstrated error; prefer existing provider/host metadata first. |
| P-05 | **Candidate / evidence needed** | Adapter tests classify failures; ACP may report underlying failures as nominal `end_turn`. Accurate token/quota telemetry isn't exposed. | Investigate truthful quota/failure signals if exposed by installed CLI APIs. Do not invent usage/remaining quota or leak diagnostic data. |
| P-06 | **Candidate / evidence needed** | Separate adapters may duplicate text/image/cancellation handling; however host APIs differ. | Audit real duplicated *logic* and maintenance cost; recommend local refactor only when simpler than divergence. Preserve independent installability. |
| P-07 | **Candidate / evidence needed** | Current adapter limitations include no mid-turn steering and no host-controlled tools, and process cleanup on Windows may be imperfect. | Evaluate concrete user-facing workflows affected. Don't build complex park/resume bridge, daemon or global runtime without demonstrable need and security proof. |
| P-08 | **Defer** | Autonomous framework inside plugins, new approval bypass, or forcing identical host behavior. | Not justified by V4 workflow goals. |

## External research applicability (not adoption decisions)

| Source | Candidate connection | Status |
| --- | --- | --- |
| R-01 Anthropic effective agents | Route only when implementation permissions/capabilities meet the engineering outcome; don't import workflow logic into provider adapter. | **Architectural direction settled in AI-skills; executor check linked audit for real project/plugin delta** |
| R-02 Anthropic multi-agent research | Investigate communication/role costs only if actual plugin limitation blocks a desired bounded delegation workflow. | **Architectural direction settled in AI-skills; executor check linked audit for real project/plugin delta** |
| R-03 Claude verification article | Provider may expose trusted execution result metadata; genuine verification policy remains in AI-skills/project. | **Architectural direction settled in AI-skills; executor check linked audit for real project/plugin delta** |
| R-04 Marmelab survey | Evaluate targeted observability/evals if a measurable reliability gap occurs; respect security and telemetry minimization. | **Architectural direction settled in AI-skills; executor check linked audit for real project/plugin delta** |
| R-05 software factory article | Host-level mechanisms may be relevant, but importing an autonomous daemon/plugin framework is not assumed. | **Indexed article audited in linked action queue; no daemon adoption** |

## Implementer challenge / review instructions

Before any later approved plugin change: inspect corresponding package `README.md`, entrypoint/adapter, manifest, tests and exact host version; identify actual user-visible failure or missing capability; compare plugin-level fix to simpler workflow-only alternative; document source/runtime evidence, security boundary, permission effects, maintenance burden, package/test change estimate and objections. A read-only instruction alone is not sandbox enforcement. Separate fake-process tests from installed-host evidence. Return material contradictions and scope changes to planner/owner rather than blindly implementing. No provider API key, tokens, customer content or raw sensitive diagnostics in research records.

Batch 01 sources: `research/v4-batch-01/results/provider-capabilities.md`, `cost-security-findings.md`, `verification.md`. The logged quota suggestions are qualitative: the batch did not measure actual tokens or costs.

Cross-repo owner of article decisions: AI-skills `research/v4-batch-01/planning/IMPROVEMENT-REGISTER.md`.
