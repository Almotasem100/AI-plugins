# V4 follow-up research — plugin boundaries and deferred tool opportunities

**Status: research only.** No source, adapter, manifest, provider, installed environment or config changes. Tool/plugin/MCP selection is reserved for the next separate workstream the user explicitly requested. Keep current independent package boundaries and review `CONTRIBUTING.md` plus package source before any future proposal.

Canonical portable findings: [AI-skills harness research](https://github.com/Almotasem100/AI-skills/blob/research/v4-composability-batch-01/research/v4-batch-01/planning/HARNESS-RESEARCH-FOLLOWUP.md).

| ID | Source / finding | Potential relevance, not implementation | Disposition |
| --- | --- | --- | --- |
| PL-HR-01 | [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/): agent-accessible runtime UI/logs/metrics and task-scoped evidence. | User selected **both** browser and static verification as future research focus. Normalized test reports and screenshot/log refs feed the expandable verification section of the approved **read-only Workflow Dashboard** (`WORKFLOW-DASHBOARD-DESIGN.md`, zero additional model calls). Do not create a new harness runtime or cloud observability platform. | **Tooling / Dashboard pilot later** |
| PL-HR-02 | [Anthropic Code Execution with MCP](https://www.anthropic.com/research/code-execution-with-mcp): progressive tool discovery and filtering intermediate output reduces model context; paper's sample savings not measured here. | Existing plugin process/error streams might benefit from concise but truthful result summaries. Examine if users actually face noisy or ambiguous output first. Don't introduce MCP server, code executor or tool bridge now. | **Investigate after concrete friction** |
| PL-HR-03 | [SWE-Skills-Bench](https://arxiv.org/abs/2603.15401): skills can be ineffective or conflict with project versions; evaluate contribution. | Don't add UI/plugin merely to increase capability count. If a real plugin is eventually chosen, compare its benefit with built-in host functionality and maintenance/security. | **Preserve small plugin set** |
| PL-HR-04 | [Anthropic Effective Harnesses for Long-Running Agents](https://www.anthropic.com/research/effective-harnesses-for-long-running-agents): durable progress across sessions. | The provider adapters do not own workflow continuity; the portable contract does. Exposing evidence pointers may help future viewer, without changing provider approval modes. | **No adapter delta** |
| PL-HR-05 | [fast-check](https://github.com/dubzzz/fast-check), [Schemathesis](https://github.com/schemathesis/schemathesis), [ast-grep](https://github.com/ast-grep/ast-grep) | These are optional **project/test/source tools**, not intrinsically plugin server features. No port or installation is justified just to wrap them. | **Defer to relevant engineering project** |

## Research-approved user preferences
- Review both static and browser verification tooling for unique uncovered benefits; don't install two tools that duplicate duties.
- The earlier *Test Evidence Viewer*-only preference has been superseded by the approved **read-only, milestone-based Workflow Dashboard inside the harness** with **zero additional AI/model calls** (`WORKFLOW-DASHBOARD-DESIGN.md`), keeping test evidence as an expandable section distinguishing passed/failed/skipped/blocked/not-run with actual test/build revision.
- Keep code review and testing skill count small; improve existing capability before adding anything.
- Do not expose sensitive customer test data or external service routes without separately approved data handling.

## Independent technical challenge for a later tool phase
First inspect installed host support, local output formats, actual permission boundaries and existing plugin APIs. Challenge novelty/duplication with evidence. No 'recommended' item authorizes building, installing, enabling MCP, changing YOLO native CLI mode, adding cloud services or merging code. Nothing in this file alters configured lanes, models or fallback.
