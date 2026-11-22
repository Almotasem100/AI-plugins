import { constants as fsConstants } from "node:fs"
import { open, realpath } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000
const MAX_FILE_BYTES = 256 * 1024
const PLACEHOLDER_BLOCKER = /^(?:none|n\/a|na|nil|nothing|no blockers?|[-–—]+)$/i
const TERMINAL_STAGE = /^(?:completed?|done|closed)$/i
const AUTHORITATIVE_MODEL_EVENTS = new Set(["assistant/message", "delegation/model-choice", "model/selection"])

function isInside(childPath, parentPath) {
  const rel = relative(parentPath, childPath)
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

function resolveLexicalPath(workspaceRoot, targetPath) {
  const root = resolve(workspaceRoot)
  const resolved = isAbsolute(targetPath) ? resolve(targetPath) : resolve(root, targetPath)
  if (!isInside(resolved, root)) {
    throw new Error("Evidence path must stay inside the approved workspace root.")
  }
  return { root, absolute: resolved, relative: relative(root, resolved).replaceAll("\\", "/") }
}

async function readConfinedText(workspaceRoot, targetPath) {
  const lexical = resolveLexicalPath(workspaceRoot, targetPath)
  const realRoot = await realpath(lexical.root)
  let realTarget
  try {
    realTarget = await realpath(lexical.absolute)
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return { missing: true, relative: lexical.relative }
    }
    throw error
  }
  if (!isInside(realTarget, realRoot)) {
    throw new Error("Evidence path escapes the approved workspace root through a link.")
  }
  // Open once and read through the handle to avoid stat -> readFile TOCTOU races.
  // On POSIX, O_NOFOLLOW also blocks a final-component symlink swap between realpath and open.
  const openFlags = process.platform !== "win32" && typeof fsConstants.O_NOFOLLOW === "number"
    ? fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
    : "r"
  const handle = await open(realTarget, openFlags)
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error("Evidence target is not a regular file.")
    if (info.size > MAX_FILE_BYTES) throw new Error("Evidence file exceeds size limit.")
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    let total = 0
    while (total < buffer.length) {
      const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)
      if (bytesRead === 0) break
      total += bytesRead
    }
    if (total > MAX_FILE_BYTES) throw new Error("Evidence file exceeds size limit.")
    return {
      missing: false,
      relative: relative(realRoot, realTarget).replaceAll("\\", "/"),
      text: buffer.subarray(0, total).toString("utf8"),
      mtimeMs: info.mtimeMs,
    }
  } finally {
    await handle.close()
  }
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
  const rawBlockers = extractSectionBullets(text, "Blockers / open questions")
  const blockers = rawBlockers.filter((item) => !PLACEHOLDER_BLOCKER.test(item))
  const completed = extractSectionBullets(text, "Completed / current state")
  const decisions = extractSectionBullets(text, "Material decisions")
  const verification = extractSectionBullets(text, "Verification state")
  const nextAction = extractSectionBullets(text, "Next action")
  const stale = typeof mtimeMs === "number" ? (nowMs - mtimeMs) > staleAfterMs : true
  const stageStatus = stage === "Unknown"
    ? "Unknown"
    : TERMINAL_STAGE.test(stage)
      ? "Completed (last reported)"
      : "Started (last reported)"
  const taskStatus = blockers.length > 0 ? "Blocked" : stageStatus

  return {
    sourcePath,
    updatedAt: typeof mtimeMs === "number" ? new Date(mtimeMs).toISOString() : "Unknown",
    stale,
    liveActivity: "Unknown",
    workflowKind: detectWorkflowKind(text),
    objective: extractField(text, "Objective"),
    activeItem: extractField(text, "Active item"),
    stage,
    stageStatus,
    hasOpenBlockers: blockers.length > 0,
    taskStatus,
    reposState: extractField(text, "Repos/state"),
    completed,
    decisions,
    blockers,
    verificationNotes: verification,
    nextAction,
  }
}

function readXmlAttr(attrs, name) {
  const present = new RegExp(`\\b${name}\\s*=`, "i").test(attrs)
  if (!present) return { present: false, valid: true, value: undefined }
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["'](\\d+)["']`, "i"))
  if (!match) return { present: true, valid: false, value: undefined }
  const value = Number.parseInt(match[1], 10)
  return Number.isSafeInteger(value) && value >= 0
    ? { present: true, valid: true, value }
    : { present: true, valid: false, value: undefined }
}

function parseJunitCounts(attrs, { requireFailures = true } = {}) {
  const total = readXmlAttr(attrs, "tests")
  const failures = readXmlAttr(attrs, "failures")
  const errors = readXmlAttr(attrs, "errors")
  const skipped = readXmlAttr(attrs, "skipped")
  if (!total.present || !total.valid) return undefined
  if (!failures.valid || !errors.valid || !skipped.valid) return undefined
  if (requireFailures && !failures.present) return undefined
  const f = failures.value ?? 0
  const e = errors.value ?? 0
  const s = skipped.value ?? 0
  const failed = f + e
  if (failed + s > total.value) return undefined
  return { total: total.value, passed: total.value - failed - s, failures: f, errors: e, failed, skipped: s }
}

function hasInvalidWrapperSummary(attrs) {
  const total = readXmlAttr(attrs, "tests")
  const failures = readXmlAttr(attrs, "failures")
  const errors = readXmlAttr(attrs, "errors")
  const skipped = readXmlAttr(attrs, "skipped")
  if (!total.valid || !failures.valid || !errors.valid || !skipped.valid) return true
  if (total.present && ((failures.value ?? 0) + (errors.value ?? 0) + (skipped.value ?? 0) > total.value)) return true
  return false
}

function hasWellFormedJunitEnvelope(trimmed, hasWrapper) {
  if (hasWrapper) {
    return /<testsuites\b[^>]*\/>/i.test(trimmed) || /<\/testsuites>\s*$/i.test(trimmed)
  }
  return /<testsuite\b[^>]*\/>/i.test(trimmed) || /<\/testsuite>\s*$/i.test(trimmed)
}

function classifyCounts({ passed, failed, skipped, blocked = 0 }) {
  if (failed > 0) return "Failed"
  if (blocked > 0) return "Blocked"
  if (passed > 0) return "Passed"
  if (skipped > 0) return "Skipped"
  return "Not Run"
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
      return {
        sourcePath,
        status: classifyCounts({ passed, failed, skipped, blocked }),
        counts: { passed, failed, skipped, blocked },
        testedRevision: typeof data.commit === "string" && data.commit.trim() ? data.commit.trim() : "Unknown",
      }
    } catch {
      return unknownReport(sourcePath)
    }
  }

  if (detected === "junit") {
    const wrapperMatch = trimmed.match(/<testsuites\b([^>]*)>/i)
    const suiteMatches = [...trimmed.matchAll(/<testsuite\b([^>]*)>/gi)]
    if (!wrapperMatch && suiteMatches.length === 0) return unknownReport(sourcePath)
    if (!hasWellFormedJunitEnvelope(trimmed, Boolean(wrapperMatch))) return unknownReport(sourcePath)

    let summed
    if (suiteMatches.length > 0) {
      summed = { total: 0, passed: 0, failures: 0, errors: 0, failed: 0, skipped: 0 }
      for (const match of suiteMatches) {
        const counts = parseJunitCounts(match[1], { requireFailures: true })
        if (!counts) return unknownReport(sourcePath)
        summed.total += counts.total
        summed.passed += counts.passed
        summed.failures += counts.failures
        summed.errors += counts.errors
        summed.failed += counts.failed
        summed.skipped += counts.skipped
      }
    }

    if (wrapperMatch && hasInvalidWrapperSummary(wrapperMatch[1])) return unknownReport(sourcePath)
    const wrapperCounts = wrapperMatch ? parseJunitCounts(wrapperMatch[1], { requireFailures: true }) : undefined
    if (wrapperMatch && !wrapperCounts && !summed) return unknownReport(sourcePath)
    if (wrapperCounts && summed) {
      if (
        wrapperCounts.total !== summed.total
        || wrapperCounts.failed !== summed.failed
        || wrapperCounts.skipped !== summed.skipped
      ) {
        return unknownReport(sourcePath)
      }
    }
    const finalCounts = summed ?? wrapperCounts
    if (!finalCounts) return unknownReport(sourcePath)

    // Guard against <failure> or <error> child elements contradicting summary counts.
    const failureTagCount = (trimmed.match(/<failure(?:\s|>|\/)/gi) ?? []).length
    const errorTagCount = (trimmed.match(/<error(?:\s|>|\/)/gi) ?? []).length
    if (failureTagCount > finalCounts.failures || errorTagCount > finalCounts.errors) {
      return unknownReport(sourcePath)
    }

    return {
      sourcePath,
      status: classifyCounts({ ...finalCounts, blocked: 0 }),
      counts: { passed: finalCounts.passed, failed: finalCounts.failed, skipped: finalCounts.skipped, blocked: 0 },
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
    return {
      participant: "Unknown",
      configuredLane: "Unknown",
      executedModel: "Unknown",
      modelVerified: false,
      modelEvidenceSource: "Unknown",
    }
  }
  const participant = typeof assignment.participant === "string" && assignment.participant.trim()
    ? assignment.participant.trim()
    : "Unknown"
  const configuredLane = typeof assignment.configuredLane === "string" && assignment.configuredLane.trim()
    ? assignment.configuredLane.trim()
    : "Unknown"

  // Require an authoritative host session execution event before reporting an executed model as verified.
  const evidence = assignment.modelEvidence
  const hasAuthoritativeEvidence = Boolean(
    evidence
    && typeof evidence === "object"
    && evidence.source === "host-session-event"
    && AUTHORITATIVE_MODEL_EVENTS.has(evidence.eventType)
    && typeof evidence.sessionId === "string" && evidence.sessionId.trim() !== ""
    && Number.isInteger(evidence.seq) && evidence.seq >= 0
    && typeof evidence.model === "string" && evidence.model.trim() !== "",
  )
  return {
    participant,
    configuredLane,
    executedModel: hasAuthoritativeEvidence ? evidence.model.trim() : "Unknown",
    modelVerified: hasAuthoritativeEvidence,
    modelEvidenceSource: hasAuthoritativeEvidence ? `${evidence.eventType}@${evidence.sessionId}#${evidence.seq}` : "Unknown",
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
    stageStatus: "Unknown",
    hasOpenBlockers: false,
    taskStatus: "Unknown",
    reposState: "Unknown",
    completed: [],
    decisions: [],
    blockers: [],
    verificationNotes: [],
    nextAction: [],
  }

  if (scratchpadPath) {
    const read = await readConfinedText(workspaceRoot, scratchpadPath)
    if (read.missing) {
      workItem.sourcePath = read.relative
    } else {
      workItem = parseScratchpad(read.text, {
        sourcePath: read.relative,
        mtimeMs: read.mtimeMs,
        nowMs,
        staleAfterMs,
      })
    }
  }

  let verification = unknownReport(testReportPath ?? "Unknown")
  if (testReportPath) {
    const read = await readConfinedText(workspaceRoot, testReportPath)
    verification = read.missing
      ? unknownReport(read.relative)
      : parseTestReport(read.text, { sourcePath: read.relative })
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
