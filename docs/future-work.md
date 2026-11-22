# Future work

## Live Workflow tab for OpenCode Desktop

A read-only sidebar diagram for longer, multi-agent tasks. Show connected steps such as
**Plan ✓ · Model A → Implement ● · Model B → Review ○ · Model C planned**.
Let the user open a worker session directly from its step.

**Why:** Answer what's running, what's waiting, and where to inspect the work without scrolling through chat
or asking a model to regenerate a summary.

**Smallest prototype:** Three steps and one real implementer-to-reviewer handoff in a test session
(estimated 4–6 files and 150–250 lines). Use explicit step assignments for the plan and observable session
activity for execution. Check that the tab can match each worker to the right step, update without a new model
summary, and link to the correct session. Show planned and actual models separately. A finished worker is not
proof that its work passed review; show outcome only when there is separate evidence.

**Defer** automatic dispatch, Jira integration, ZadLoop support, and HDC-documents changes. Revisit a larger
diagram only if the prototype works without ongoing manual upkeep.

The `/ticket-status` experiment is a formatted chat summary, not a source of live state. Its
[sample evidence record](experiments/work-evidence.md) remains useful as an example of how to label verification.
