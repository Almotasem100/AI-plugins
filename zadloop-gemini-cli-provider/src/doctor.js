import { spawn } from "node:child_process"
import { access, constants, realpath } from "node:fs/promises"
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path"
import { createInterface } from "node:readline"
import { pathToFileURL } from "node:url"

const VERSION_TIMEOUT_MS = 10_000
const ACP_TIMEOUT_MS = 20_000
const CLEANUP_TIMEOUT_MS = 2_000
const MAX_VERSION_BYTES = 4 * 1024
const MAX_ACP_BYTES = 256 * 1024
const INITIALIZE_ID = 1
const VERSION_TOKEN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const FAILURES = {
  notFound: "Gemini CLI was not found in an absolute PATH directory outside this package.",
  launcherEntry: "Gemini CLI's npm launcher was found, but its JavaScript entry point was missing.",
  nodeMissing: "Gemini CLI's npm launcher needs node.exe on PATH outside this package.",
  spawn: "Gemini CLI could not start.",
  versionTimeout: "Gemini CLI --version did not finish in time.",
  versionExit: "Gemini CLI --version did not succeed.",
  versionOutput: "Gemini CLI --version did not print one plain semantic version.",
  versionLimit: "Gemini CLI --version output exceeded the size limit.",
  acpTimeout: "Gemini CLI --acp did not answer initialize in time.",
  acpClosed: "Gemini CLI --acp exited before answering initialize.",
  acpHandshake: "Gemini CLI --acp did not complete a compatible initialize.",
  acpCapability: "Gemini CLI --acp advertised an invalid image capability.",
  acpProtocol: "Gemini CLI --acp output was not valid JSON-RPC.",
  acpLimit: "Gemini CLI --acp output exceeded the size limit.",
  cleanup: "Gemini CLI termination could not be confirmed.",
  unexpected: "Gemini CLI doctor failed unexpectedly.",
}
const FIXED_FAILURES = new Set(Object.values(FAILURES))

function fixedFailure(error) {
  return FIXED_FAILURES.has(error?.message) ? error.message : FAILURES.unexpected
}

function isInside(directory, parent) {
  const pathFromParent = relative(parent, directory)
  return pathFromParent === "" || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
}

function isNpmLocalBin(directory) {
  return /[\\/]node_modules[\\/]\.bin$/i.test(directory.replace(/[\\/]+$/, ""))
}

async function realDirectory(directory) {
  try {
    return await realpath(directory)
  } catch {
    return undefined
  }
}

async function isFileOutside(file, projectReal, mode) {
  try {
    await access(file, mode)
    return !isInside(await realpath(file), projectReal)
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES" || error.code === "ENOTDIR") return false
    throw error
  }
}

// PATH is user-configured trust, not a sandbox. Relative entries, entries inside
// this diagnostic's project, and npm's injected node_modules/.bin entries are
// skipped so the probe cannot pick up a package-local or cwd-derived CLI.
async function trustedDirectories(env, projectDirectory) {
  const projectReal = (await realDirectory(projectDirectory)) ?? projectDirectory
  const directories = []
  for (const entry of (env.PATH ?? env.Path ?? "").split(delimiter)) {
    if (!entry || !isAbsolute(entry)) continue
    const directory = resolve(entry)
    if (isInside(directory, projectDirectory) || isNpmLocalBin(directory)) continue
    const real = await realDirectory(directory)
    if (!real || isInside(real, projectReal)) continue
    directories.push(directory)
  }
  return { directories, projectReal }
}

async function resolveNode(directories, projectReal) {
  for (const directory of directories) {
    const candidate = join(directory, "node.exe")
    if (await isFileOutside(candidate, projectReal, constants.F_OK)) return candidate
  }
  return undefined
}

async function resolveGemini(env, cwd) {
  const projectDirectory = resolve(cwd)
  const { directories, projectReal } = await trustedDirectories(env, projectDirectory)
  const names = process.platform === "win32" ? ["gemini.exe", "gemini.cmd", "gemini.bat"] : ["gemini"]
  const mode = process.platform === "win32" ? constants.F_OK : constants.X_OK
  for (const directory of directories) {
    for (const name of names) {
      const candidate = join(directory, name)
      if (!(await isFileOutside(candidate, projectReal, mode))) continue
      if (process.platform === "win32" && /\.(cmd|bat)$/i.test(name)) {
        const entryPoint = join(directory, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
        if (!(await isFileOutside(entryPoint, projectReal, constants.F_OK))) throw new Error(FAILURES.launcherEntry)
        const node = await resolveNode(directories, projectReal)
        if (!node) throw new Error(FAILURES.nodeMissing)
        return { command: node, args: [entryPoint] }
      }
      return { command: candidate, args: [] }
    }
  }
  throw new Error(FAILURES.notFound)
}

function trackClose(child) {
  const state = { complete: false }
  state.promise = new Promise((resolveClose) => {
    child.once("close", (code, signal) => {
      state.complete = true
      resolveClose({ code, signal })
    })
  })
  return state
}

function isGroupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

async function terminateTree(child) {
  if (!child.pid) {
    try {
      child.kill()
      return true
    } catch {
      return false
    }
  }
  const killRoot = () => {
    try {
      child.kill()
    } catch {}
  }
  if (process.platform === "win32") {
    return await new Promise((resolveTerminate) => {
      let settled = false
      let timer
      const finish = (confirmed) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolveTerminate(confirmed)
      }
      const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe")
      const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        windowsHide: true,
      })
      timer = setTimeout(() => {
        killer.kill()
        killRoot()
        finish(false)
      }, CLEANUP_TIMEOUT_MS)
      killer.once("error", () => { killRoot(); finish(false) })
      killer.once("close", (code) => {
        if (code !== 0) killRoot()
        finish(code === 0)
      })
    })
  }
  try {
    process.kill(-child.pid, "SIGTERM")
    return true
  } catch {
    try {
      child.kill("SIGTERM")
      return true
    } catch {
      return false
    }
  }
}

async function waitForClose(closeState) {
  let timer
  try {
    return await Promise.race([
      closeState.promise.then(() => true),
      new Promise((resolveWait) => { timer = setTimeout(() => resolveWait(false), CLEANUP_TIMEOUT_MS) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function waitForGroupExit(pid) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!isGroupAlive(pid)) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  return !isGroupAlive(pid)
}

async function stopChild(child, closeState, terminate) {
  let terminationRequested = true
  if (!closeState.complete) terminationRequested = await terminate(child)
  let closed = closeState.complete || (await waitForClose(closeState))
  if (process.platform !== "win32" && child.pid && isGroupAlive(child.pid)) {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }
    const groupGone = await waitForGroupExit(child.pid)
    closed = (closeState.complete || (await waitForClose(closeState))) && groupGone
  }
  // A failed kill is never reported as confirmed, even if the root and its
  // pipes later close; Windows descendants cannot be verified after that.
  const confirmed = closed && terminationRequested
  if (!confirmed) {
    for (const stream of [child.stdin, child.stdout, child.stderr]) {
      if (typeof stream?.destroy === "function") stream.destroy()
    }
    // Do not let an unconfirmed child keep the doctor's event loop alive.
    child.unref?.()
  }
  return confirmed
}

function spawnCli(cli, args, cwd, env, stdio) {
  return spawn(cli.command, [...cli.args, ...args], {
    cwd,
    env,
    detached: process.platform !== "win32",
    shell: false,
    stdio,
    windowsHide: true,
  })
}

function parseVersion(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "")
  if (lines.length !== 1) return undefined
  return VERSION_TOKEN.test(lines[0]) ? lines[0] : undefined
}

async function probeVersion(cli, cwd, env, timeoutMs, terminate) {
  const child = spawnCli(cli, ["--version"], cwd, env, ["ignore", "pipe", "pipe"])
  const closeState = trackClose(child)
  let spawnFailed = false
  child.once("error", () => { spawnFailed = true })
  child.stderr.resume()
  const chunks = []
  let bytes = 0
  let overflow = false
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length
    if (bytes > MAX_VERSION_BYTES) {
      overflow = true
      child.stdout.destroy()
      return
    }
    chunks.push(chunk)
  })
  child.stdout.on("error", () => {})
  const timedOut = Symbol("timeout")
  let timer
  const closed = await Promise.race([
    closeState.promise,
    new Promise((resolveWait) => { timer = setTimeout(() => resolveWait(timedOut), timeoutMs) }),
  ])
  clearTimeout(timer)
  const confirmed = await stopChild(child, closeState, terminate)
  const errors = []
  let version
  if (closed === timedOut) errors.push(FAILURES.versionTimeout)
  else if (spawnFailed) errors.push(FAILURES.spawn)
  else if (overflow) errors.push(FAILURES.versionLimit)
  else if (closed.code !== 0) errors.push(FAILURES.versionExit)
  else {
    version = parseVersion(Buffer.concat(chunks).toString("utf8"))
    if (!version) errors.push(FAILURES.versionOutput)
  }
  if (!confirmed) errors.push(FAILURES.cleanup)
  return { version, errors }
}

function classifyImageCapability(result) {
  const agentCapabilities = result.agentCapabilities
  if (agentCapabilities === undefined) return { image: "unsupported", valid: true }
  if (!agentCapabilities || typeof agentCapabilities !== "object" || Array.isArray(agentCapabilities)) {
    return { image: "unknown", valid: false }
  }
  const promptCapabilities = agentCapabilities.promptCapabilities
  if (promptCapabilities === undefined) return { image: "unsupported", valid: true }
  if (!promptCapabilities || typeof promptCapabilities !== "object" || Array.isArray(promptCapabilities)) {
    return { image: "unknown", valid: false }
  }
  if (!Object.hasOwn(promptCapabilities, "image")) return { image: "unsupported", valid: true }
  if (promptCapabilities.image === true) return { image: "supported", valid: true }
  if (promptCapabilities.image === false) return { image: "unsupported", valid: true }
  // An advertised capability of an unexpected type is not trusted either way.
  return { image: "unknown", valid: false }
}

async function probeAcp(cli, cwd, env, timeoutMs, terminate) {
  const child = spawnCli(cli, ["--acp"], cwd, env, ["pipe", "pipe", "pipe"])
  const closeState = trackClose(child)
  child.stderr.resume()
  let settled = false
  let resolveOutcome
  const outcome = new Promise((resolvePromise) => { resolveOutcome = resolvePromise })
  const settle = (value) => {
    if (settled) return
    settled = true
    resolveOutcome(value)
  }
  let bytes = 0
  child.stdout.on("data", (chunk) => {
    bytes += chunk.length
    if (bytes <= MAX_ACP_BYTES) return
    settle({ kind: "failure", message: FAILURES.acpLimit })
    child.stdout.destroy()
  })
  child.stdout.on("error", () => {})
  child.once("error", () => settle({ kind: "failure", message: FAILURES.spawn }))
  closeState.promise.then(() => settle({ kind: "closed" }))
  child.stdin.on("error", () => settle({ kind: "closed" }))

  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on("error", () => settle({ kind: "failure", message: FAILURES.acpProtocol }))
  lines.on("line", (line) => {
    if (settled || line.trim() === "") return
    let message
    try {
      message = JSON.parse(line)
    } catch {
      settle({ kind: "failure", message: FAILURES.acpProtocol })
      return
    }
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
      settle({ kind: "failure", message: FAILURES.acpProtocol })
      return
    }
    if (typeof message.method === "string" && message.id !== undefined) {
      // Refuse unsolicited client methods; the doctor approves nothing.
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method unavailable" } })}\n`)
      } catch {}
      return
    }
    if (!Object.hasOwn(message, "id") && typeof message.method === "string") return
    if (message.id !== INITIALIZE_ID) {
      settle({ kind: "failure", message: FAILURES.acpProtocol })
      return
    }
    const hasResult = Object.hasOwn(message, "result")
    const hasError = Object.hasOwn(message, "error")
    if (hasResult === hasError) {
      settle({ kind: "failure", message: FAILURES.acpProtocol })
      return
    }
    if (hasError) {
      settle({ kind: "failure", message: FAILURES.acpHandshake })
      return
    }
    const result = message.result
    if (!result || typeof result !== "object" || Array.isArray(result) || result.protocolVersion !== 1) {
      settle({ kind: "failure", message: FAILURES.acpHandshake })
      return
    }
    const capability = classifyImageCapability(result)
    if (!capability.valid) {
      settle({ kind: "failure", message: FAILURES.acpCapability })
      return
    }
    settle({ kind: "handshake", image: capability.image })
  })

  try {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: INITIALIZE_ID, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } })}\n`)
  } catch {
    settle({ kind: "closed" })
  }
  let timer
  const timedOut = new Promise((resolveWait) => {
    timer = setTimeout(() => resolveWait({ kind: "timeout" }), timeoutMs)
  })
  const result = await Promise.race([outcome, timedOut])
  clearTimeout(timer)
  lines.close()
  const confirmed = await stopChild(child, closeState, terminate)
  const errors = []
  if (result.kind === "failure") errors.push(result.message)
  else if (result.kind === "timeout") errors.push(FAILURES.acpTimeout)
  else if (result.kind === "closed") errors.push(FAILURES.acpClosed)
  if (!confirmed) errors.push(FAILURES.cleanup)
  return {
    handshake: result.kind === "handshake",
    image: result.kind === "handshake" ? result.image : "unknown",
    errors,
  }
}

export function formatReport(report) {
  const acp = report.acp === "ok" ? "ok" : report.acp === "failed" ? "failed" : "not run"
  const lines = [
    `Gemini CLI doctor: ${report.ok ? "ok" : "failed"}`,
    `CLI version: ${report.version ?? "unverified"}`,
    `ACP initialize: ${acp}`,
    `ACP image input: ${report.image}`,
  ]
  for (const message of report.errors) lines.push(`Failure: ${message}`)
  return `${lines.join("\n")}\n`
}

export async function runDoctor(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd())
  const env = options.env ?? process.env
  const terminate = options.terminate ?? terminateTree
  const report = { ok: false, version: undefined, acp: "skipped", image: "unknown", errors: [] }
  let cli
  try {
    cli = await resolveGemini(env, cwd)
  } catch (error) {
    report.errors.push(fixedFailure(error))
    return report
  }
  const version = await probeVersion(cli, cwd, env, options.probeTimeoutMs ?? VERSION_TIMEOUT_MS, terminate)
  report.version = version.version
  report.errors.push(...version.errors)
  if (version.errors.length > 0) return report
  const acp = await probeAcp(cli, cwd, env, options.probeTimeoutMs ?? ACP_TIMEOUT_MS, terminate)
  report.acp = acp.handshake ? "ok" : "failed"
  report.image = acp.image
  report.errors.push(...acp.errors)
  report.ok = report.errors.length === 0
  return report
}

export async function main() {
  let report
  try {
    report = await runDoctor()
  } catch {
    report = { ok: false, version: undefined, acp: "skipped", image: "unknown", errors: [FAILURES.unexpected] }
  }
  process.stdout.write(formatReport(report))
  return report.ok ? 0 : 1
}

function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  try {
    return pathToFileURL(resolve(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (invokedDirectly()) process.exitCode = await main()
