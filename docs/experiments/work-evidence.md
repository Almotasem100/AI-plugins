# Work evidence — PR #1 "Harden plugin regressions and repository checks"

Slice 3 of the [plugin upgrades plan](../plans/plugin-upgrades.md). This is a retrospective, not exhaustive host acceptance.

## Verified automation
- [PR #1](https://github.com/Almotasem100/AI-plugins/pull/1) merged as `b39cf68`.
- Corrected run 44391855533 at head `b620d97`: both `test (windows-latest)` and `test (ubuntu-latest)` completed with `Run npm test` succeeded — https://github.com/Almotasem100/AI-plugins/actions/runs/44391855533
- The PR author also reported six offline suites passing on Windows with Node 22 and package dry runs containing the declared entry points.

## Initially failing Windows CI
- Run 44391507041 (head `4bcf119`) failed only on Windows: job 135110120868, `not ok 8 - a real taskkill failure is reported without hiding the protocol error` (`opencode-gemini-cli-provider/test/gemini.test.js:306`); Ubuntu passed in the same run — https://github.com/Almotasem100/AI-plugins/actions/runs/44391507041/job/135110120868
- The fixture pointed `SystemRoot` at a missing directory before launching the fake CLI, affecting more than cleanup. Test-only fix `b620d97` redirects just the `taskkill.exe` spawn and leaves `SystemRoot` intact.

## Live observations
- Coordinator: live OpenCode with Gemini 3.8 Flash named Donald Duck and "blue" from an attached PNG.
- Owner, conversation only: closing and reopening the ZadLoop subscription popup while a request is loading works.

## Gaps
- The PR description still listed the popup check as pending at merge; the owner confirmed it in conversation, not in CI or the PR.
- The live observations cover those two paths only, not other providers, models, or failure paths.

## Criterion for a GUI panel
Try this view on an active task. Build a panel only if keeping it current or finding the underlying evidence repeatedly takes longer than reading it.
