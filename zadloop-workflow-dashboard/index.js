import { access } from "node:fs/promises"
import { constants as fsConstants } from "node:fs"
import { join } from "node:path"
import { collectDashboardSnapshot } from "./src/adapter.mjs"

export const inject = ["connection", "sessions", "workingDirectory"]

const SCRATCHPAD_CANDIDATES = [
  "active-work/scratchpad.md",
  "scratchpad.md",
]

const TEST_REPORT_CANDIDATES = [
  "test-results/junit.xml",
  "test-results/results.xml",
  "junit.xml",
  "test-results/summary.json",
]

async function firstExistingRelativePath(workspaceRoot, candidates) {
  for (const rel of candidates) {
    try {
      await access(join(workspaceRoot, rel), fsConstants.R_OK)
      return rel
    } catch {
      // Missing or unreadable candidate; continue checking deterministic list.
    }
  }
  return undefined
}

/**
 * Extract participant & executed-model evidence strictly from genuine ZadLoop
 * `dsh-session` events (`session.snapshotEvents()`). Only `assistant/message`
 * events with a recorded `data.message.source.model` establish executed model
 * identity; `model/selection` alone is configured intent, never execution proof.
 */
export function extractSessionAssignment(session, sessionId) {
  if (!session || typeof session !== "object") return undefined
  const participant = session.meta?.origin === "subagent" ? "subagent" : "session"
  const events = typeof session.snapshotEvents === "function"
    ? session.snapshotEvents()
    : (Array.isArray(session.events) ? session.events : [])

  let configuredLane = "Unknown"
  let modelEvidence
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event || typeof event !== "object") continue
    if (!modelEvidence && event.type === "assistant/message") {
      const source = event.data?.message?.source
      const model = typeof source?.model === "string" ? source.model.trim() : ""
      const provider = typeof source?.provider === "string" ? source.provider.trim() : ""
      if (model && Number.isInteger(event.seq) && event.seq >= 0 && typeof sessionId === "string" && sessionId.trim()) {
        modelEvidence = {
          source: "host-session-event",
          eventType: "assistant/message",
          sessionId: sessionId.trim(),
          seq: event.seq,
          model: provider ? `${provider}/${model}` : model,
        }
      }
    }
    if (configuredLane === "Unknown" && event.type === "model/selection") {
      const selModel = typeof event.data?.model === "string" ? event.data.model.trim() : ""
      const selProvider = typeof event.data?.provider === "string" ? event.data.provider.trim() : ""
      if (selModel) configuredLane = selProvider ? `${selProvider}/${selModel}` : selModel
    }
    if (modelEvidence && configuredLane !== "Unknown") break
  }

  return {
    participant,
    configuredLane,
    ...(modelEvidence ? { modelEvidence } : {}),
  }
}

export async function readWorkflowDashboard({ sessions, workingDirectory, sessionId, nowMs = Date.now() }) {
  const normalizedId = typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : undefined
  const session = normalizedId ? sessions?.get?.(normalizedId) : undefined
  const workspaceRoot = session
    ? workingDirectory?.get?.(session)
    : workingDirectory?.defaultDirectory

  if (typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return {
      readOnly: true,
      additionalModelCalls: 0,
      collectedAt: new Date(nowMs).toISOString(),
      sessionId: normalizedId ?? "Unknown",
      workspaceStatus: "Unavailable",
      workItem: {
        sourcePath: "Unknown",
        updatedAt: "Unknown",
        stale: true,
        liveActivity: "Unknown",
        workflowKind: "Unknown",
        objective: "Unknown",
        activeItem: "Unknown",
        stage: "Unknown",
        stageStatus: "Unknown",
        hasOpenBlockers: false,
        taskStatus: "Unknown",
        reposState: "Unknown",
        completed: [],
        decisions: [],
        blockers: [],
        verificationNotes: [],
        nextAction: [],
      },
      participant: {
        participant: "Unknown",
        configuredLane: "Unknown",
        executedModel: "Unknown",
        modelVerified: false,
        modelEvidenceSource: "Unknown",
      },
      verification: {
        sourcePath: "Unknown",
        status: "Unknown",
        counts: { passed: 0, failed: 0, skipped: 0, blocked: 0 },
        testedRevision: "Unknown",
      },
    }
  }

  const [scratchpadPath, testReportPath] = await Promise.all([
    firstExistingRelativePath(workspaceRoot, SCRATCHPAD_CANDIDATES),
    firstExistingRelativePath(workspaceRoot, TEST_REPORT_CANDIDATES),
  ])

  const snapshot = await collectDashboardSnapshot({
    workspaceRoot,
    scratchpadPath,
    testReportPath,
    assignment: extractSessionAssignment(session, normalizedId),
    nowMs,
  })

  return {
    ...snapshot,
    sessionId: normalizedId ?? "Unknown",
    workspaceStatus: "Resolved",
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.connection.fetch.register({
    path: "/api/workflow-dashboard",
    methods: ["GET"],
    requestBody: "buffered",
    async fetch(request) {
      try {
        const url = new URL(request?.url ?? "/api/workflow-dashboard", "http://localhost")
        const sessionId = url.searchParams.get("sessionId") ?? undefined
        const result = await readWorkflowDashboard({
          sessions: ctx.sessions,
          workingDirectory: ctx.workingDirectory,
          sessionId,
        })
        return Response.json(result, { headers: { "cache-control": "no-store" } })
      } catch {
        return Response.json({ error: "unavailable" }, {
          status: 503,
          headers: { "cache-control": "no-store" },
        })
      }
    },
  }), "zadloop-workflow-dashboard: read-only status route")
}
