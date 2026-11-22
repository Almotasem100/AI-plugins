import assert from "node:assert/strict"
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { collectDashboardSnapshot, extractParticipantIdentity, parseTestReport } from "../src/adapter.mjs"

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

test("collectDashboardSnapshot reads scratchpad, JUnit report, and verified participant with zero model calls", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wf-dashboard-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const scratchpad = join(dir, "scratchpad.md")
  const report = join(dir, "junit.xml")
  await writeFile(scratchpad, SAMPLE_SCRATCHPAD, "utf8")
  await writeFile(report, '<testsuite name="adapter" tests="5" failures="0" errors="0" skipped="1"></testsuite>', "utf8")

  const nowMs = Date.now()
  const snap = await collectDashboardSnapshot({
    workspaceRoot: dir,
    scratchpadPath: "scratchpad.md",
    testReportPath: "junit.xml",
    assignment: { participant: "implementer", configuredLane: "default", executedModel: "gemini-3.8-flash" },
    nowMs,
  })

  assert.equal(snap.readOnly, true)
  assert.equal(snap.additionalModelCalls, 0)
  assert.equal(snap.workItem.workflowKind, "Full Feature")
  assert.equal(snap.workItem.stage, "Implementation")
  assert.equal(snap.workItem.status, "Blocked")
  assert.equal(snap.workItem.stale, false)
  assert.equal(snap.workItem.liveActivity, "Unknown")
  assert.deepEqual(snap.workItem.blockers, ["Owner approval needed for Stage 2 UI"])
  assert.equal(snap.participant.executedModel, "gemini-3.8-flash")
  assert.equal(snap.participant.modelVerified, true)
  assert.equal(snap.verification.status, "Passed")
  assert.deepEqual(snap.verification.counts, { passed: 4, failed: 0, skipped: 1, blocked: 0 })
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
  assert.equal(snap.workItem.status, "Started (last reported)")
  assert.equal(snap.workItem.liveActivity, "Unknown")
})

test("missing or malformed test reports never become Passed", async (t) => {
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

  const skippedOnly = parseTestReport(JSON.stringify({ passed: 0, failed: 0, skipped: 2 }))
  assert.equal(skippedOnly.status, "Skipped")

  const blocked = parseTestReport(JSON.stringify({ passed: 2, failed: 0, skipped: 0, blocked: 1 }))
  assert.equal(blocked.status, "Blocked")
})

test("configured lane alone never fabricates an executed model identity", () => {
  const id = extractParticipantIdentity({ participant: "reviewer", configuredLane: "review-main" })
  assert.equal(id.configuredLane, "review-main")
  assert.equal(id.executedModel, "Unknown")
  assert.equal(id.modelVerified, false)
})

test("path traversal outside workspaceRoot is rejected", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wf-dashboard-path-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await assert.rejects(
    collectDashboardSnapshot({ workspaceRoot: dir, scratchpadPath: "../outside.md" }),
    /inside the approved workspace root/,
  )
})
