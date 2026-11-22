import { readFile, stat } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000
const MAX_FILE_BYTES = 256 * 1024

function resolveConfinedPath(workspaceRoot, targetPath) {
  const root = resolve(workspaceRoot)
  const resolved = isAbsolute(targetPath) ? resolve(targetPath) : resolve(root, targetPath)
  const rel = relative(root, resolved)
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Evidence path must stay inside the approved workspace root.")
  }
  return { absolute: resolved, relative: rel.replaceAll("\\", "/") }
}

async function readBoundedText(filePath) {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error("Evidence target is not a regular file.")
  if (info.size > MAX_FILE_BYTES) throw new Error("Evidence file exceeds size limit.")
  const text = await readFile(filePath, "utf8")
  return { text, mtimeMs: info.mtimeMs }
}

function extractField(text, label) {
  const match = text.match(new RegExp(`^\\*\\*${label}:\\*\\*\\s*(.+)$`, "mi"))
  const value = match?.[1]?.trim()
  if (!value || /^<[^>]+>$/.test(value)) return "Unknown"
  return value
}

function extractSectionBullets(text, heading) {
  const sections = text.split(/^##\s+/m).slice(1)
  const target = heading.trim().toLowerCase()
  const section = sections.find((block) => block.split(/\r?\n/, 1)[0].trim().toLowerCase() === target)
  if (!section) return []
  return section
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((item) => item && !/^<[^>]+>$/.test(item))
}

function detectWorkflowKind(text) {
  if (/\bFull Feature\b/i.test(text)) return "Full Feature"
  if (/\bChange\/Bug\b/i.test(text)) return "Change/Bug"
  return "Unknown"
}

export function parseScratchpad(text, { sourcePath = "scratchpad.md", mtimeMs, nowMs = Date.now(), staleAfterMs = DEFAULT_STALE_MS } = {}) {
  const stage = extractField(text, "Stage")
  const blockers = extractSectionBullets(text, "Blockers / open questions")
  const completed = extractSectionBullets(text, "Completed / current state")
  const decisions = extractSectionBullets(text, "Material decisions")
  const verification = extractSectionBullets(text, "Verification state")
  const nextAction = extractSectionBullets(text, "Next action")
  const stale = typeof mtimeMs === "number" ? (nowMs - mtimeMs) > staleAfterMs : true
  const status = blockers.length > 0
    ? "Blocked"
    : stage !== "Unknown"
      ? (/complete|done|closed/i.test(stage) ? "Completed" : "Started (last reported)")
      : "Unknown"

  return {
    sourcePath,
    updatedAt: typeof mtimeMs === "number" ? new Date(mtimeMs).toISOString() : "Unknown",
    stale,
    liveActivity: "Unknown",
    workflowKind: detectWorkflowKind(text),
    objective: extractField(text, "Objective"),
    activeItem: extractField(text, "Active item"),
    stage,
    status,
    reposState: extractField(text, "Repos/state"),
    completed,
    decisions,
    blockers,
    verificationNotes: verification,
    nextAction,
  }
}

export function parseTestReport(text, { sourcePath = "report", format } = {}) {
  const trimmed = text.trim()
  const detected = format ?? (trimmed.startsWith("{") ? "json" : trimmed.startsWith("<") ? "junit" : "unknown")

  if (detected === "json") {
    try {
      const data = JSON.parse(trimmed)
      if (!data || typeof data !== "object" || Array.isArray(data)) return unknownReport(sourcePath)
      const passed = Number.isInteger(data.passed) && data.passed >= 0 ? data.passed : undefined
      const failed = Number.isInteger(data.failed) && data.failed >= 0 ? data.failed : undefined
      const skipped = Number.isInteger(data.skipped) && data.skipped >= 0 ? data.skipped : 0
      const blocked = Number.isInteger(data.blocked) && data.blocked >= 0 ? data.blocked : 0
      if (passed === undefined || failed === undefined) return unknownReport(sourcePath)
      const status = failed > 0
        ? "Failed"
        : blocked > 0
          ? "Blocked"
          : passed > 0
            ? "Passed"
            : skipped > 0
              ? "Skipped"
              : "Not Run"
      return {
        sourcePath,
        status,
        counts: { passed, failed, skipped, blocked },
        testedRevision: typeof data.commit === "string" && data.commit.trim() ? data.commit.trim() : "Unknown",
      }
    } catch {
      return unknownReport(sourcePath)
    }
  }

  if (detected === "junit") {
    const suite = trimmed.match(/<testsuite\b([^>]*)>/i)
    if (!suite) return unknownReport(sourcePath)
    const attrs = suite[1]
    const readInt = (name) => {
      const m = attrs.match(new RegExp(`\\b${name}=["'](\\d+)["']`, "i"))
      return m ? Number.parseInt(m[1], 10) : undefined
    }
    const total = readInt("tests")
    const failures = readInt("failures") ?? 0
    const errors = readInt("errors") ?? 0
    const skipped = readInt("skipped") ?? 0
    if (total === undefined) return unknownReport(sourcePath)
    const failed = failures + errors
    const passed = Math.max(0, total - failed - skipped)
    const status = failed > 0
      ? "Failed"
      : passed > 0
        ? "Passed"
        : skipped > 0
          ? "Skipped"
          : "Not Run"
    return {
      sourcePath,
      status,
      counts: { passed, failed, skipped, blocked: 0 },
      testedRevision: "Unknown",
    }
  }

  return unknownReport(sourcePath)
}

function unknownReport(sourcePath) {
  return {
    sourcePath,
    status: "Unknown",
    counts: { passed: 0, failed: 0, skipped: 0, blocked: 0 },
    testedRevision: "Unknown",
  }
}

export function extractParticipantIdentity(assignment) {
  if (!assignment || typeof assignment !== "object") {
    return { participant: "Unknown", configuredLane: "Unknown", executedModel: "Unknown", modelVerified: false }
  }
  const participant = typeof assignment.participant === "string" && assignment.participant.trim()
    ? assignment.participant.trim()
    : "Unknown"
  const configuredLane = typeof assignment.configuredLane === "string" && assignment.configuredLane.trim()
    ? assignment.configuredLane.trim()
    : "Unknown"
  // Never infer executedModel from configuredLane; require explicit recorded execution evidence.
  const executedModel = typeof assignment.executedModel === "string" && assignment.executedModel.trim()
    ? assignment.executedModel.trim()
    : "Unknown"
  return {
    participant,
    configuredLane,
    executedModel,
    modelVerified: executedModel !== "Unknown",
  }
}

export async function collectDashboardSnapshot({
  workspaceRoot,
  scratchpadPath,
  testReportPath,
  assignment,
  nowMs = Date.now(),
  staleAfterMs = DEFAULT_STALE_MS,
}) {
  let workItem = {
    sourcePath: "Unknown",
    updatedAt: "Unknown",
    stale: true,
    liveActivity: "Unknown",
    workflowKind: "Unknown",
    objective: "Unknown",
    activeItem: "Unknown",
    stage: "Unknown",
    status: "Unknown",
    reposState: "Unknown",
    completed: [],
    decisions: [],
    blockers: [],
    verificationNotes: [],
    nextAction: [],
  }

  if (scratchpadPath) {
    const confined = resolveConfinedPath(workspaceRoot, scratchpadPath)
    try {
      const { text, mtimeMs } = await readBoundedText(confined.absolute)
      workItem = parseScratchpad(text, { sourcePath: confined.relative, mtimeMs, nowMs, staleAfterMs })
    } catch {
      workItem.sourcePath = confined.relative
    }
  }

  let verification = unknownReport(testReportPath ?? "Unknown")
  if (testReportPath) {
    const confined = resolveConfinedPath(workspaceRoot, testReportPath)
    try {
      const { text } = await readBoundedText(confined.absolute)
      verification = parseTestReport(text, { sourcePath: confined.relative })
    } catch {
      verification = unknownReport(confined.relative)
    }
  }

  return {
    readOnly: true,
    additionalModelCalls: 0,
    collectedAt: new Date(nowMs).toISOString(),
    workItem,
    participant: extractParticipantIdentity(assignment),
    verification,
  }
}
