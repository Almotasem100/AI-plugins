# V4 article audit — AI-plugins review queue

**Planning only until source-backed executable issue is found.** This repository owns host adapters, NOT workflow decisions, verification policy, model quotas, or the user's workflow selection. No plugin install/production entrypoint/config/permission modification is authorized by this research handoff.

## Five-source applicability
| Source | Assessment for provider/plugins | Disposition |
| --- | --- | --- |
| [R-01 Effective Agents](https://www.anthropic.com/research/building-effective-agents) | Tool descriptions and failure reporting should be clear; provider doesn't own Full Feature vs Change/Bug. | INVESTIGATE only actual misleading interfaces. |
| [R-02 Multi-Agent Research](https://www.anthropic.com/research/multi-agent-research-system) | Concise specialist results help orchestration; **do not** add model routing or alter native-subagent selection. | PRESERVE adapter role; real failure reproduction first. |
| [R-03 Claude Verification](https://claude.dev/blog/how-the-claude-code-team-thinks-about-verification/) | Host/provider failure classification matters: apparent `end_turn` may hide actual terminal error and invalidate verification evidence. | **EXECUTOR-READY-CANDIDATE to test existing fake/ACP failure path**; modify only if demonstrably wrong and correctable. |
| [R-04 Marmelab Harness Survey](https://marmelab.com/blog/2026/09/24/the-state-of-ai-harness-engineering-2026.html) | Keep offline process tests; add real host smoke only when changed host behavior merits it; don't confuse mocked and installed. | PRESERVE separation; no harness bake-off. |
| [R-05 Factory](https://thebuildingmachine.com/p/a-look-inside-the-factory) | Daemon/process supervisors, exact-commit review, persistent jobs are infrastructure beyond these provider adapters. | DEFER. |

## Concrete candidates and strict security boundaries
- **P-09 terminal-status honesty (executor-ready to reproduce, not presumed defect):** Inspect current provider/ACP handling and relevant tests for quota, cancellation, partial output and misleading terminal success. Build one precise synthetic regression if a real mismatch exists, compare pre/post behavior; no broad adapter rewrite or global status schema.
- **P-10 tool invocation ergonomics (investigate):** If a current plugin/CLI action has ambiguous inputs, unclear failure output, or unsupported image/tool capabilities, improve the owning package's wording or small adapter boundary. Cite a real wrong-route case rather than adding a capability registry.
- **P-11 cost telemetry (investigate):** Only record usage/quota if actual CLI/host exposes trustworthy metadata. Unknown stays unknown. No subscription inference, provider accounting or token dashboard implementation from this source alone.
- **P-12 permissions (preserve):** Gemini native tools running with YOLO are not subject to OpenCode/ZadLoop host-tool approvals. Never call prompt instruction 'read-only enforcement'. No host-tool bridge, sandbox bypass, permission escalation or additional corporate data routing without separate design/approval.

## Independent executor response
Check current README, CONTRIBUTING, adapters and fake-process tests plus source version. Return **already covered / safe minimal fix / unsupported claim / conflict / owner choice**. If a safe defect is confirmed, place the tiny change and tests *only on this research branch*; otherwise make no production code edit. Record actual evidence and exit status under research results. Do not touch installed providers, `master`, corporate systems or credentials.

Cross-repo generic owner: [AI-skills five-source audit](https://github.com/Almotasem100/AI-skills/blob/research/v4-composability-batch-01/research/v4-batch-01/planning/FIVE-ARTICLE-AUDIT.md).
