import assert from "node:assert/strict"
import { mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { collectDashboardSnapshot, extractParticipantIdentity, parseScratchpad, parseTestReport } from "../src/adapter.mjs"

const SAMPLE_SCRATCHPAD = `# CB-101 — active work scratchpad

**Objective:** Deliver read-only workflow status
**Active item:** Full Feature — CB-101
**Stage:** Implementation
**Repos/state:** AI-plugins feat/dashboard @ abc1234

## Completed / current state
- Host API feasibility verified

## Material decisions
- Pilot host is ZadLoop

## Blockers / open questions
- Owner approval needed for Stage 2 UI

## Verification state
- Offline adapter tests passing

## Next action
- Present Stage 1 findings for review
`

test("collectDashboardSnapshot reads scratchpad, JUnit report, and authoritative host model evidence with zero model calls", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wf-dashboard-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, "scratchpad.md"), SAMPLE_SCRATCHPAD, "utf8")
  await writeFile(join(dir, "junit.xml"), '<testsuite name="adapter" tests="5" failures="0" errors="0" skipped="1"></testsuite>', "utf8")

  const snap = await collectDashboardSnapshot({
    workspaceRoot: dir,
    scratchpadPath: "scratchpad.md",
    testReportPath: "junit.xml",
    assignment: {
      participant: "implementer",
      configuredLane: "default",
      modelEvidence: { source: "host-session-event", eventType: "assistant/message", sessionId: "sess-1", seq: 4, model: "gemini-3.8-flash" },
    },
    nowMs: Date.now(),
  })

  assert.equal(snap.readOnly, true)
  assert.equal(snap.additionalModelCalls, 0)
  assert.equal(snap.workItem.workflowKind, "Full Feature")
  assert.equal(snap.workItem.stage, "Implementation")
  assert.equal(snap.workItem.stageStatus, "Started (last reported)")
  assert.equal(snap.workItem.hasOpenBlockers, true)
  assert.equal(snap.workItem.taskStatus, "Blocked")
  assert.equal(snap.workItem.stale, false)
  assert.equal(snap.workItem.liveActivity, "Unknown")
  assert.equal(snap.participant.executedModel, "gemini-3.8-flash")
  assert.equal(snap.participant.modelVerified, true)
  assert.equal(snap.participant.modelEvidenceSource, "assistant/message@sess-1#4")
  assert.equal(snap.verification.status, "Passed")
  assert.deepEqual(snap.verification.counts, { passed: 4, failed: 0, skipped: 1, blocked: 0 })
})

test("placeholder blockers and non-terminal stage substrings do not fabricate Blocked or Completed", () => {
  const incomplete = parseScratchpad(`**Stage:** Incomplete review\n\n## Blockers / open questions\n- None\n- n/a\n- —\n`, { mtimeMs: Date.now() })
  assert.equal(incomplete.hasOpenBlockers, false)
  assert.deepEqual(incomplete.blockers, [])
  assert.equal(incomplete.stageStatus, "Started (last reported)")
  assert.equal(incomplete.taskStatus, "Started (last reported)")

  const notDone = parseScratchpad(`**Stage:** Implementation not done\n`, { mtimeMs: Date.now() })
  assert.equal(notDone.stageStatus, "Started (last reported)")
  assert.equal(notDone.taskStatus, "Started (last reported)")

  const done = parseScratchpad(`**Stage:** Completed\n`, { mtimeMs: Date.now() })
  assert.equal(done.stageStatus, "Completed (last reported)")
  assert.equal(done.taskStatus, "Completed (last reported)")
})

test("stale scratchpad is labeled stale and never infers live activity", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wf-dashboard-stale-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const scratchpad = join(dir, "scratchpad.md")
  await writeFile(scratchpad, SAMPLE_SCRATCHPAD.replace("- Owner approval needed for Stage 2 UI\n", ""), "utf8")
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
  await utimes(scratchpad, old, old)

  const snap = await collectDashboardSnapshot({
    workspaceRoot: dir,
    scratchpadPath: "scratchpad.md",
    staleAfterMs: 24 * 60 * 60 * 1000,
  })
  assert.equal(snap.workItem.stale, true)
  assert.equal(snap.workItem.taskStatus, "Started (last reported)")
  assert.equal(snap.workItem.liveActivity, "Unknown")
})

test("multi-suite JUnit and inconsistent/missing attributes never produce false Passed", () => {
  const multiSuiteFail = parseTestReport(`
    <testsuites tests="4" failures="1" errors="0" skipped="0">
      <testsuite name="a" tests="2" failures="0" errors="0" skipped="0"></testsuite>
      <testsuite name="b" tests="2" failures="1" errors="0" skipped="0"></testsuite>
    </testsuites>
  `)
  assert.equal(multiSuiteFail.status, "Failed")
  assert.deepEqual(multiSuiteFail.counts, { passed: 3, failed: 1, skipped: 0, blocked: 0 })

  const inconsistentWrapper = parseTestReport(`
    <testsuites tests="4" failures="0" errors="0" skipped="0">
      <testsuite name="a" tests="2" failures="0" errors="0" skipped="0"></testsuite>
      <testsuite name="b" tests="2" failures="1" errors="0" skipped="0"></testsuite>
    </testsuites>
  `)
  assert.equal(inconsistentWrapper.status, "Unknown")

  const missingTestsAttr = parseTestReport(`<testsuite name="a" failures="0"></testsuite>`)
  assert.equal(missingTestsAttr.status, "Unknown")

  const impossibleCounts = parseTestReport(`<testsuite name="a" tests="1" failures="2"></testsuite>`)
  assert.equal(impossibleCounts.status, "Unknown")
})

test("missing or malformed JSON test reports never become Passed", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wf-dashboard-missing-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, "bad.json"), "{not-valid-json", "utf8")

  const missing = await collectDashboardSnapshot({ workspaceRoot: dir, testReportPath: "missing.json" })
  assert.equal(missing.verification.status, "Unknown")

  const malformed = await collectDashboardSnapshot({ workspaceRoot: dir, testReportPath: "bad.json" })
  assert.equal(malformed.verification.status, "Unknown")

  const failed = parseTestReport(JSON.stringify({ passed: 3, failed: 1, skipped: 0, commit: "deadbeef" }))
  assert.equal(failed.status, "Failed")
  assert.equal(failed.testedRevision, "deadbeef")
})

test("unverified executedModel string or configured lane alone never marks modelVerified true", () => {
  const laneOnly = extractParticipantIdentity({ participant: "reviewer", configuredLane: "review-main" })
  assert.equal(laneOnly.executedModel, "Unknown")
  assert.equal(laneOnly.modelVerified, false)

  const unverifiedString = extractParticipantIdentity({ participant: "implementer", executedModel: "gemini-3.8-flash" })
  assert.equal(unverifiedString.executedModel, "Unknown")
  assert.equal(unverifiedString.modelVerified, false)

  const wrongSource = extractParticipantIdentity({
    participant: "implementer",
    modelEvidence: { source: "scratchpad", eventType: "assistant/message", sessionId: "s1", seq: 1, model: "gemini-3.8-flash" },
  })
  assert.equal(wrongSource.executedModel, "Unknown")
  assert.equal(wrongSource.modelVerified, false)
})

test("lexical path traversal and symlink/junction escapes outside workspaceRoot are rejected", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "wf-dashboard-ws-"))
  const outside = await mkdtemp(join(tmpdir(), "wf-dashboard-outside-"))
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  await writeFile(join(outside, "secret.md"), "**Objective:** secret\n", "utf8")

  await assert.rejects(
    collectDashboardSnapshot({ workspaceRoot: workspace, scratchpadPath: "../outside.md" }),
    /inside the approved workspace root/,
  )

  const linkPath = join(workspace, "escaped-link")
  await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir")
  await assert.rejects(
    collectDashboardSnapshot({ workspaceRoot: workspace, scratchpadPath: "escaped-link/secret.md" }),
    /escapes the approved workspace root/,
  )
})
