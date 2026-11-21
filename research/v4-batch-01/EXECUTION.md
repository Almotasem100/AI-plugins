# V4 Batch 01 — AI-plugins capability, permissions and quota experiment

**Research-only.** Branch: `research/v4-composability-batch-01` from `master`. This file is an experiment brief, not a permanent plugin configuration. Do not modify `master`, live plugin configuration, installed plugins, credentials or production packages.

## Goal
Determine whether available OpenCode and ZadLoop integrations provide enough trustworthy signals for V4 capability selection: image modalities, host tools, Gemini-native tools, effective approvals, role containment, cancellation, failures, continuation and relative quota efficiency. Report real evidence and missing evidence; do not design a new plugin framework by assumption.

## Preconditions
1. Read `README.md`, `CONTRIBUTING.md`, root `package.json`, both Gemini provider READMEs, applicable package manifests/tests, and the sibling AI-skills portable contract. Preserve existing uncommitted work. Record base and branch SHAs.
2. Never broaden Gemini YOLO/native-tool permissions; Gemini-native actions are not necessarily subject to host tool approvals. Do not access secrets, private company code or authenticated corporate services. Use public/synthetic material and mocked subprocesses for the experimental cases.
3. No installs, host updates, account authentication probes, paid repeated calls, permission changes or active-host configuration edits. A native Gemini subagent may review public/synthetic findings only if actual access and effective permission boundaries are safe. Never equate a read-only instruction with enforced containment.

## Research experiments
**P1 — Capability matrix.** Compare OpenCode Gemini provider, ZadLoop Gemini provider and AI-skills CLI delegation: text, PNG/JPEG/WebP/GIF, host-controlled tool bridging, Gemini-native tool execution, approval enforcement, mid-turn steering, session continuity, cancellation, errors/partial output, model/effort mapping and live-vs-mock evidence. Cite exact README/source/test paths and unsupported fields.

**P2 — Route fitness.** Create synthetic test cases requiring (a) image input, (b) host-controlled tools, (c) independently enforceable read-only review, (d) ordinary text summarization. Make deterministic Node built-in tests for any objective capability-record decisions. A route relying on Gemini's YOLO tool loop must not be mislabeled host-approved or contained. Separate documented support from empirically proven behavior.

**P3 — Existing checks.** Inspect root scripts before executing; run `npm test` once, relevant research-specific Node tests, and `git diff --check`. Record commands/exits. Distinguish fake-process tests from real host/CLI integration; do not claim runtime compatibility from offline green tests.

**P4 — Quota-aware orchestration.** Compare deterministic scripts, low-cost configured Gemini specialists, and expensive root models for suitable tasks. Capture only actually observable invocation counts or execution metadata; do not invent token counts, prices, remaining quota, or latency. Propose a least-cost-sufficient selection strategy that preserves ownership, capability constraints and acceptance quality.

**P5 — Improvement candidates.** Rank actual useful candidates such as capability introspection, permission-aware selection or better failure evidence against simpler alternatives. Host-controlled bridging and mid-request steering are out of scope until isolation, authorization, correlation and cancellation can be validated. Do not implement unsafe bridging.

## Results and completion
Under `research/v4-batch-01/results/`, produce `provider-capabilities.md`, `synthetic-route-fixtures.md`, `verification.md`, `cost-security-findings.md`, and a one-page `handoff.md`. Put optional research-only fixtures/tests in this research directory. Mark cases pass/fail/blocked/unverified; include exact repo SHA, source evidence and commands. Commit/push only research files to `research/v4-composability-batch-01`. Do not merge, publish, or alter the existing providers. Complete one bounded batch with no endless retries.
