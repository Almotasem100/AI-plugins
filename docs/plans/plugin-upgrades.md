# Plugin upgrades — implementation plan

Baseline: `b39cf68` on `master`. The three slices are independent. Keep plugin install paths and contracts intact. No live calls, host changes, publication, or new dependencies in this pass.

## 1. ZadLoop usage refresh

Start with ZadLoop; leave the OpenCode panel unchanged until there is user feedback. Keep the current popup data visible while a manual refresh is loading. Show **Last checked** after a completed valid snapshot. If the HTTP request fails, times out, or cannot produce a valid snapshot, keep previous data for that open popup and label it **Stale**; first-load failure still shows the existing error. A later valid snapshot replaces the earlier one, timestamp and all, including authoritative per-provider statuses such as not signed in; never retain individual cached windows over new provider statuses. Ignore late completions. Keep immediate cancellation on close, clear the snapshot on close, and start clean on reopen. No storage, polling, server, or credential rules changes.

Smallest design: one snapshot (data and timestamp) in the existing popup state; no cache module. Estimated 3 files, 50–100 changed lines: `usage-panel/client.js`, `test/client.test.mjs`, and README within that package. Use the registered trigger/Refresh handlers in tests: first load, visible prior result while pending, timeout/error and stale label, successful replacement, and closing/reopening without old data. Run `npm --prefix usage-panel test`; installed ZadLoop smoke remains separate.

## 2. Gemini CLI doctor

Provide an explicitly invoked, standalone `npm run doctor` in each Gemini package, with ordinary provider behavior unchanged. Accept only a trimmed version token (`major.minor.patch`, with optional SemVer-style prerelease/build suffixes). ACP `image: true` means **supported**; `false` or omitted in a valid handshake means **unsupported**; invalid or unconfirmed initialization means **unknown**. Exit zero only for successful version and handshake checks with confirmed cleanup; lack of advertised image support alone is not a failure. Do not infer authentication, quota, model availability, or successful image delivery. Use `--version` and `--acp` with only the ACP `initialize` exchange. No session creation, prompt, YOLO flag, auth/credential inspection, raw child diagnostics or environment output.

Smallest standalone alternative to a host command/UI: keep identical package-local implementations (no runtime sibling import or provider exports). Resolve executable candidates from user-configured absolute PATH entries outside the diagnostic project, not from cwd or npm's implicit local bins; use the standard Windows npm layout without a shell. This checks the diagnostic process's PATH, not either host's actual resolution. Bound output, each stage and cleanup; report unconfirmed cleanup rather than success. Estimated 8 files and 220–360 changed lines across both packages, including manifests, docs, and boundary tests. Supply fake PATH only to test child processes rather than changing the global environment or finding a real CLI; cover supported/unsupported, startup or handshake failure, no session/prompt, timeout and cleanup, and suppression of raw diagnostics. Run both provider suites; no actual Gemini invocation required in this slice.

## 3. Work-evidence experiment

Use merged PR #1 as a completed real slice. Record a concise [Markdown evidence view](../experiments/work-evidence.md) distinguishing verified automation, live observations, initially failing Windows CI versus the corrected rerun, and what was observed by the owner rather than by the coordinator. Link to the PR and check runs; do not invent evidence or imply exhaustive host acceptance. Include what would justify promoting this to a GUI panel.

Smallest design: one roughly 20–30 line file at `docs/experiments/work-evidence.md`; no parser, runtime integration, workflow policy, storage, or UI. Validate chronology and links against PR history/CI and the owner's report.

## Integration

Use disjoint write scopes; the coordinator owns this plan and final review. Review actual diffs against these acceptance paths and run root `npm test` plus `git diff --check`. Check doctor package inclusion and Windows/POSIX portability separately from live-host claims.

Implementation note: the doctor exceeded its estimate. It keeps launch, protocol validation, and bounded cleanup separate from runtime provider code, with package-local copies and fake-CLI regressions in both packages. The root parity test guards against drift. Before adding another host or probe, revisit whether the duplicate packaging still pays for itself.
