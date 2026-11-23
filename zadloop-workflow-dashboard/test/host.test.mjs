import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { apply, extractSessionAssignment, readWorkflowDashboard } from "../index.js"

const SCRATCHPAD = `# CB-202 — active work scratchpad

**Objective:** Deliver Stage 2 sidebar
**Active item:** Full Feature — CB-202
**Stage:** Review
**Repos/state:** AI-plugins feat/stage2 @ 1122334

## Completed / current state
- Host route wired

## Blockers / open questions
- None

## Verification state
- Offline tests green

## Next action
- Independent review
`

test("apply registers GET /api/workflow-dashboard and disposes cleanly when disabled", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "wf-host-"))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, "active-work"), { recursive: true })
  await mkdir(join(dir, "test-results"), { recursive: true })
  await writeFile(join(dir, "active-work", "scratchpad.md"), SCRATCHPAD, "utf8")
  await writeFile(join(dir, "test-results", "junit.xml"), '<testsuite name="s" tests="3" failures="0" errors="0" skipped="0"></testsuite>', "utf8")

  let route
  let disposed = false
  const cleanups = []
  const session = {
    meta: { origin: undefined },
    snapshotEvents() {
      return [
        { type: "model/selection", seq: 1, data: { provider: "gemini", model: "gemini-3.8-flash" } },
        { type: "assistant/message", seq: 5, data: { message: { source: { provider: "gemini", model: "gemini-3.8-flash" } } } },
      ]
    },
  }
  const ctx = {
    sessions: { get: (id) => (id === "sess-42" ? session : undefined) },
    workingDirectory: { get: () => dir, defaultDirectory: dir },
    connection: {
      fetch: {
        register(entry) {
          route = entry
          return () => { disposed = true }
        },
      },
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === "function") cleanups.push(dispose)
    },
  }

  apply(ctx)
  assert.equal(route.path, "/api/workflow-dashboard")
  assert.deepEqual(route.methods, ["GET"])

  const response = await route.fetch({ url: "http://localhost/api/workflow-dashboard?sessionId=sess-42" })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const body = await response.json()
  assert.equal(body.readOnly, true)
  assert.equal(body.additionalModelCalls, 0)
  assert.equal(body.sessionId, "sess-42")
  assert.equal(body.workItem.activeItem, "Full Feature — CB-202")
  assert.equal(body.workItem.sourcePath, "active-work/scratchpad.md")
  assert.equal(body.participant.executedModel, "gemini/gemini-3.8-flash")
  assert.equal(body.participant.modelVerified, true)
  assert.equal(body.participant.modelEvidenceSource, "assistant/message@sess-42#5")
  assert.equal(body.verification.status, "Passed")
  assert.equal(body.verification.sourcePath, "test-results/junit.xml")

  for (const dispose of cleanups) dispose()
  assert.equal(disposed, true)
})

test("model/selection without assistant/message never fabricates an executed model", () => {
  const session = {
    meta: { origin: "subagent" },
    snapshotEvents() {
      return [
        { type: "model/selection", seq: 2, data: { provider: "anthropic", model: "claude-opus-5-5" } },
      ]
    },
  }
  const assignment = extractSessionAssignment(session, "sub-1")
  assert.equal(assignment.participant, "subagent")
  assert.equal(assignment.configuredLane, "anthropic/claude-opus-5-5")
  assert.equal(assignment.modelEvidence, undefined)
})

test("missing, invalid, unknown, or mismatched sessionId fails closed without reading defaultDirectory", async (t) => {
  const defaultDir = await mkdtemp(join(tmpdir(), "wf-default-"))
  t.after(() => rm(defaultDir, { recursive: true, force: true }))
  await writeFile(join(defaultDir, "scratchpad.md"), SCRATCHPAD, "utf8")

  const cases = [
    { label: "missing sessionId", sessionId: undefined, sessions: { get: () => undefined } },
    { label: "malformed sessionId", sessionId: "../escape", sessions: { get: () => ({ id: "../escape" }) } },
    { label: "unknown sessionId", sessionId: "sess-unknown", sessions: { get: () => undefined } },
    { label: "mismatched session object", sessionId: "sess-a", sessions: { get: () => ({ id: "sess-b", snapshotEvents: () => [] }) } },
  ]

  for (const c of cases) {
    const snap = await readWorkflowDashboard({
      sessions: c.sessions,
      workingDirectory: { get: () => defaultDir, defaultDirectory: defaultDir },
      sessionId: c.sessionId,
    })
    assert.equal(snap.readOnly, true, c.label)
    assert.equal(snap.additionalModelCalls, 0, c.label)
    assert.equal(snap.workspaceStatus, "Unavailable", c.label)
    assert.equal(snap.workItem.activeItem, "Unknown", c.label)
    assert.equal(snap.workItem.sourcePath, "Unknown", c.label)
    assert.equal(snap.participant.executedModel, "Unknown", c.label)
    assert.equal(snap.verification.status, "Unknown", c.label)
  }

  const emptyDir = await mkdtemp(join(tmpdir(), "wf-empty-"))
  t.after(() => rm(emptyDir, { recursive: true, force: true }))
  const emptySnap = await readWorkflowDashboard({
    sessions: { get: (id) => (id === "sess-empty" ? { id: "sess-empty", snapshotEvents: () => [] } : undefined) },
    workingDirectory: { get: () => emptyDir, defaultDirectory: defaultDir },
    sessionId: "sess-empty",
  })
  assert.equal(emptySnap.additionalModelCalls, 0)
  assert.equal(emptySnap.workspaceStatus, "Resolved")
  assert.equal(emptySnap.workItem.taskStatus, "Unknown")
  assert.equal(emptySnap.verification.status, "Unknown")
})
