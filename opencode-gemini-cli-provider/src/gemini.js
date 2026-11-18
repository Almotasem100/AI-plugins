import { spawn } from "node:child_process"
import { once } from "node:events"
import { access, constants } from "node:fs/promises"
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline"

const CLI_PROMPT = "Complete the task provided on standard input. Treat it as the user's request."
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const CLEANUP_TIMEOUT_MS = 2_000
const OUTPUT_LIMIT_MESSAGE = "Gemini CLI output exceeded the 16 MiB limit."
const TIMEOUT_MESSAGE = `Gemini CLI did not finish within ${DEFAULT_TIMEOUT_MS} ms.`
const CANCELLED_MESSAGE = "Gemini task was cancelled."
const PROTOCOL_MESSAGE = "Gemini CLI output was not valid stream-json. Update Gemini CLI or this provider."
const ACP_PROTOCOL_MESSAGE = "Gemini CLI ACP output was not valid JSON-RPC. Update Gemini CLI or this provider."

export function validateModel(model) {
  if (model === undefined || model === "") return undefined
  if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)) {
    throw new Error("Model must be a Gemini CLI model ID containing only letters, numbers, '.', '_' or '-'.")
  }
  return model
}

function sanitizeSpawnError(error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{1,32}$/.test(error.code)
    ? error.code
    : undefined
  const safeError = new Error(`Gemini CLI could not start${code ? ` (${code})` : ""}.`)
  if (code) safeError.code = code
  return safeError
}

function authenticationFailure() {
  return new Error("Gemini CLI authentication failed. Run `gemini` in a terminal to sign in again.")
}

function quotaFailure() {
  return new Error("Gemini CLI quota or rate limit reached. Wait before retrying, or select another model.")
}

function turnLimitFailure() {
  return new Error("Gemini CLI reached its session turn limit. Increase maxSessionTurns in Gemini CLI settings to allow more turns.")
}

function inputFailure() {
  return new Error("Gemini CLI rejected the request.")
}

function toolFailure() {
  return new Error("Gemini CLI tool execution failed.")
}

function sandboxFailure() {
  return new Error("Gemini CLI could not run inside its sandbox.")
}

function workspaceFailure() {
  return new Error("Gemini CLI did not trust this workspace. Trust the project folder in Gemini CLI settings or run outside the plugin.")
}

function configFailure() {
  return new Error("Gemini CLI could not start because of its configuration.")
}

function resultFailure(errorPayload) {
  const type = typeof errorPayload?.type === "string" ? errorPayload.type : ""
  const message = typeof errorPayload?.message === "string" ? errorPayload.message : ""
  const combined = `${type} ${message}`
  if (/auth/i.test(type) || /authentication|not authenticated|login required|sign in/i.test(message)) {
    return authenticationFailure()
  }
  if (/quota|rate.?limit|resource.?exhausted|\b429\b/i.test(combined)) return quotaFailure()
  if (/turn.?limit/i.test(type)) return turnLimitFailure()
  if (/tool/i.test(type)) return toolFailure()
  if (/input/i.test(type)) return inputFailure()
  if (/sandbox/i.test(type)) return sandboxFailure()
  if (/untrusted|trust/i.test(type)) return workspaceFailure()
  if (/config/i.test(type)) return configFailure()
  if (/cancel/i.test(type)) return new Error(CANCELLED_MESSAGE)
  return new Error("Gemini CLI reported a failure.")
}

function exitFailure(exitCode, exitSignal) {
  if (exitCode === 42) return inputFailure()
  if (exitCode === 53) return turnLimitFailure()
  const outcome =
    exitCode === null || exitCode === undefined
      ? `was terminated by signal ${exitSignal ?? "unknown"}`
      : `exited with code ${exitCode}`
  return new Error(`Gemini CLI ${outcome} before reporting a final result.`)
}

function finishTextResponse(state, exitCode, exitSignal) {
  if (!state.result) throw exitFailure(exitCode, exitSignal)
  // A failed result may omit its error payload (for example INVALID_STREAM), so the
  // last severe error event remains the only actionable diagnostic.
  if (state.result.status !== "success") throw resultFailure(state.result.error ?? state.lastError)
  if (state.terminalError) throw state.terminalError
  if (exitCode !== 0) throw exitFailure(exitCode, exitSignal)
  return state.text
}

function requestAbortError(signal, timeoutSignal) {
  if (signal?.aborted) return new Error(CANCELLED_MESSAGE)
  if (timeoutSignal.aborted) return new Error(TIMEOUT_MESSAGE)
}

function processHasExited(child, closeState) {
  // POSIX cleanup checks the process group separately after skipping a dead root.
  return closeState.complete
    || (child.exitCode !== null && child.exitCode !== undefined)
    || (child.signalCode !== null && child.signalCode !== undefined)
}

function requestProcessTermination(child) {
  if (!child.pid) {
    child.kill()
    return Promise.resolve()
  }

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows"
    const taskkill = join(systemRoot, "System32", "taskkill.exe")
    return new Promise((resolve, reject) => {
      const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
      let settled = false
      const timer = setTimeout(() => {
        killer.kill()
        fail()
      }, CLEANUP_TIMEOUT_MS)
      const finish = () => {
        clearTimeout(timer)
        settled = true
      }
      const fail = () => {
        if (settled) return
        finish()
        child.kill()
        reject(new Error("Gemini CLI process-tree termination failed."))
      }
      killer.once("error", () => {
        fail()
      })
      killer.once("close", (exitCode) => {
        if (exitCode === 0) {
          finish()
          resolve()
          return
        }
        fail()
      })
    })
  }

  signalProcessGroup(child, "SIGTERM")
  return Promise.resolve()
}

function terminate(child, closeState) {
  if (!closeState.termination) {
    // A close event confirms the process and every inherited stdio handle closed.
    // If the root exited but a descendant still holds a pipe, closeState stays open
    // and Windows taskkill is still attempted; POSIX checks the process group.
    if (closeState.complete) return Promise.resolve()
    if (process.platform !== "win32" && processHasExited(child, closeState)) return Promise.resolve()
    closeState.termination = requestProcessTermination(child)
  }
  return closeState.termination
}

function signalProcessGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

function trackClose(child) {
  const state = { complete: false, termination: undefined }
  state.promise = new Promise((resolve) => {
    child.once("close", (...event) => {
      state.complete = true
      resolve(event)
    })
  })
  return state
}

async function stopProcessTree(child, closeState) {
  const cleanupErrors = []
  try {
    await terminate(child, closeState)
  } catch {
    cleanupErrors.push(new Error("Gemini CLI process-tree termination failed."))
  }
  if (process.platform !== "win32" && child.pid) {
    try {
      await waitForProcessGroup(child.pid)
      if (isProcessGroupAlive(child.pid)) signalProcessGroup(child, "SIGKILL")
    } catch {
      cleanupErrors.push(new Error("Gemini CLI process-group termination could not be confirmed."))
    }
  }
  if (!closeState.complete && !(await waitForCloseBounded(closeState))) {
    child.stdin?.destroy()
    child.stdout?.destroy()
    child.stderr?.destroy()
    cleanupErrors.push(new Error("Gemini CLI stdio did not close within the cleanup limit."))
  }
  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) throw new AggregateError(cleanupErrors, "Gemini CLI process cleanup was incomplete.")
}

async function waitForCloseBounded(closeState) {
  let timer
  try {
    return await Promise.race([
      closeState.promise.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), CLEANUP_TIMEOUT_MS) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function withCleanupFailure(failure, cleanupError) {
  const requestError = failure instanceof Error ? failure : new Error(String(failure))
  const processError = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError))
  return new AggregateError(
    [requestError, processError],
    `${requestError.message} Process-tree cleanup also failed: ${processError.message}`,
  )
}

async function waitForProcessGroup(pid) {
  for (let attempt = 0; attempt < 40 && isProcessGroupAlive(pid); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function isProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (error.code === "ESRCH") return false
    if (error.code === "EPERM") return true
    throw error
  }
}

function isInside(directory, parent) {
  const pathFromParent = relative(parent, directory)
  if (pathFromParent === "") return true
  return pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent)
}

async function isExecutable(file) {
  try {
    await access(file, process.platform === "win32" ? constants.F_OK : constants.X_OK)
    return true
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES") return false
    throw error
  }
}

async function resolveNodeExecutable(projectDirectory) {
  for (const pathDirectory of (process.env.PATH ?? "").split(delimiter)) {
    const searchDirectory = resolve(pathDirectory || homedir())
    if (isInside(searchDirectory, projectDirectory)) continue
    const candidate = join(searchDirectory, "node.exe")
    if (await isExecutable(candidate)) return candidate
  }
  throw new Error("The Gemini CLI npm launcher was found, but node.exe was not found outside the project on PATH.")
}

async function resolveGeminiCommand(cwd) {
  const projectDirectory = resolve(cwd)
  const pathDirectories = (process.env.PATH ?? "").split(delimiter)
  for (const pathDirectory of pathDirectories) {
    const searchDirectory = resolve(pathDirectory || homedir())
    if (isInside(searchDirectory, projectDirectory)) continue
    const names = process.platform === "win32" ? ["gemini.exe", "gemini.cmd", "gemini.bat"] : ["gemini"]
    for (const name of names) {
      const candidate = join(searchDirectory, name)
      if (!(await isExecutable(candidate))) continue
      if (process.platform === "win32" && /\.(cmd|bat)$/i.test(candidate)) {
        const entryPoint = join(searchDirectory, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
        if (!(await isExecutable(entryPoint))) {
          throw new Error(`Found ${candidate}, but could not locate the Gemini CLI JavaScript entry point next to it.`)
        }
        return { command: await resolveNodeExecutable(projectDirectory), args: [entryPoint] }
      }
      return { command: candidate, args: [] }
    }
  }
  throw new Error("Gemini CLI was not found on PATH outside the current project directory.")
}

function limitOutputBytes(stream, fail) {
  let bytes = 0
  stream.on("data", (chunk) => {
    bytes += chunk.length
    if (bytes > MAX_OUTPUT_BYTES) fail(new Error(OUTPUT_LIMIT_MESSAGE))
  })
  // The process close event reports the real outcome; a stdout error is not itself
  // a terminal result and must not surface as an unhandled stream error.
  stream.on("error", () => {})
}

function requestContext(child, task, signal) {
  const closeState = trackClose(child)
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const executionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const context = { child, closeState, signal, timeoutSignal, executionSignal }
  child.once("error", (error) => {
    context.spawnError = sanitizeSpawnError(error)
  })
  child.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") terminate(child, closeState).catch(() => {})
  })
  child.stdin.end(task)
  return context
}

async function stopAfterFailure(context, failure) {
  const primaryError = requestAbortError(context.signal, context.timeoutSignal) ?? failure
  try {
    await stopProcessTree(context.child, context.closeState)
  } catch (cleanupError) {
    throw withCleanupFailure(primaryError, cleanupError)
  }
  throw primaryError
}

function parseStreamEvent(line) {
  try {
    return JSON.parse(line)
  } catch {
    throw new Error(PROTOCOL_MESSAGE)
  }
}

function parseAcpMessage(line) {
  try {
    return JSON.parse(line)
  } catch {
    throw new Error(ACP_PROTOCOL_MESSAGE)
  }
}

function applyStreamEvent(event, state, onText) {
  if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
    throw new Error(PROTOCOL_MESSAGE)
  }
  switch (event.type) {
    case "init":
    case "tool_use":
    case "tool_result":
      return
    case "error": {
      if (event.severity === "warning") return
      if (typeof event.message !== "string" || event.message === "") return
      state.lastError = { message: event.message }
      // Gemini CLI 0.68 emits this terminal max_turns condition as severity:error
      // but follows it with result.status=success; unrelated errors may be recoverable.
      if (/^maximum session turns exceeded$/i.test(event.message.trim())) {
          state.terminalError = turnLimitFailure()
      }
      return
    }
    case "message": {
      if (state.result) return
      if (event.role !== "assistant" || typeof event.content !== "string" || event.content === "") return
      // The CLI marks incremental chunks with delta: true. A message without the
      // marker is a complete snapshot, so it is only used before any text was emitted.
      if (event.delta !== true && state.emitted) return
      state.emitted = true
      state.text += event.content
      onText?.(event.content)
      return
    }
    case "result": {
      if (state.result) throw new Error(PROTOCOL_MESSAGE)
      state.result = event
      return
    }
    default:
      // Unknown nonfatal events stay forward-compatible; only an absent result fails the request.
      return
  }
}

async function readStreamJsonProcess(context, onText) {
  const state = {
    text: "",
    emitted: false,
    result: undefined,
    lastError: undefined,
    terminalError: undefined,
    failure: undefined,
  }
  let rejectLines
  const lines = createInterface({ input: context.child.stdout, crlfDelay: Infinity })
  const linesDone = new Promise((resolve, reject) => {
    rejectLines = reject
    lines.on("line", (line) => {
      if (state.failure || line.trim() === "") return
      try {
        applyStreamEvent(parseStreamEvent(line), state, onText)
      } catch (error) {
        state.failure = error
        rejectLines(error)
        terminate(context.child, context.closeState).catch(() => {})
      }
    })
    lines.on("close", resolve)
  })
  linesDone.catch(() => {})
  limitOutputBytes(context.child.stdout, (error) => {
    if (state.failure) return
    state.failure = error
    rejectLines(error)
    terminate(context.child, context.closeState).catch(() => {})
  })

  try {
    const [[exitCode, exitSignal]] = await Promise.all([
      once(context.child, "close", { signal: context.executionSignal }),
      linesDone,
    ])
    if (state.failure) throw state.failure
    return finishTextResponse(state, exitCode, exitSignal)
  } catch (error) {
    lines.close()
    await linesDone.catch(() => {})
    await stopAfterFailure(context, context.spawnError ?? error)
  }
}

export async function runGeminiTask({ task, cwd, model, signal, onText }) {
  if (typeof task !== "string" || task.trim() === "") {
    throw new Error("Task must not be empty.")
  }
  const selectedModel = validateModel(model)
  if (signal?.aborted) throw new Error(CANCELLED_MESSAGE)

  const cli = await resolveGeminiCommand(cwd)
  const args = ["--prompt", CLI_PROMPT, "--output-format", "stream-json", "--approval-mode=yolo"]
  if (selectedModel) args.push("--model", selectedModel)
  const child = spawn(cli.command, [...cli.args, ...args], {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  const context = requestContext(child, task, signal)
  // stderr is drained so a verbose CLI cannot block on a full pipe. Its raw text is
  // not shown to users; failures rely on structured events and exit codes instead.
  child.stderr.resume()
  return readStreamJsonProcess(context, onText)
}

// Images use ACP because headless output accepts only a text prompt.
export async function runGeminiImageTask({ task, images, cwd, model, signal, onText }) {
  const selectedModel = validateModel(model)
  if (signal?.aborted) throw new Error(CANCELLED_MESSAGE)
  const cli = await resolveGeminiCommand(cwd)
  const args = ["--acp", "--approval-mode=yolo"]
  if (selectedModel) args.push("--model", selectedModel)
  const child = spawn(cli.command, [...cli.args, ...args], {
    cwd, detached: process.platform !== "win32", env: process.env, shell: false,
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  })
  const closeState = trackClose(child)
  child.stderr.resume()
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const executionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextID = 0
  let sessionID
  let responseText = ""
  let responseBytes = 0
  let failure
  const fail = (error) => {
    if (failure) return
    failure = error
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  const onAbort = () => fail(new Error(signal?.aborted ? CANCELLED_MESSAGE : TIMEOUT_MESSAGE))
  executionSignal.addEventListener("abort", onAbort, { once: true })
  limitOutputBytes(child.stdout, fail)
  child.on("error", (error) => fail(sanitizeSpawnError(error)))
  child.stdin.on("error", fail)
  child.on("close", () => fail(new Error("Gemini CLI ACP process closed unexpectedly.")))
  lines.on("line", (line) => {
    if (failure) return
    try {
      const message = parseAcpMessage(line)
      if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
        throw new Error(ACP_PROTOCOL_MESSAGE)
      }
      if (typeof message.method === "string" && message.id !== undefined) {
        // Never auto-approve a request we cannot display through OpenCode.
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method unavailable" } })}\n`)
      } else if (message.method === "session/update") {
        if (typeof sessionID !== "string" || message.params?.sessionId !== sessionID) return
        const update = message.params.update
        if (update?.sessionUpdate !== "agent_message_chunk" || update.content?.type !== "text") return
        const text = update.content.text
        if (typeof text !== "string" || text === "") return
        responseBytes += Buffer.byteLength(text)
        if (responseBytes > MAX_OUTPUT_BYTES) throw new Error(OUTPUT_LIMIT_MESSAGE)
        responseText += text
        onText?.(text)
      } else if (message.id !== undefined) {
        if (!pending.has(message.id)) throw new Error(ACP_PROTOCOL_MESSAGE)
        const hasResult = Object.hasOwn(message, "result")
        const hasError = Object.hasOwn(message, "error")
        if (hasResult === hasError) throw new Error(ACP_PROTOCOL_MESSAGE)
        const entry = pending.get(message.id)
        pending.delete(message.id)
        if (hasError) {
          entry.reject(new Error("Gemini CLI ACP request failed."))
        } else entry.resolve(message.result)
      } else if (typeof message.method !== "string") throw new Error(ACP_PROTOCOL_MESSAGE)
    } catch (error) { fail(error) }
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure)
    const id = ++nextID
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })
  let requestFailure
  try {
    if (executionSignal.aborted) onAbort()
    const init = await request("initialize", { protocolVersion: 1, clientCapabilities: {} })
    if (init?.protocolVersion !== 1 || init.agentCapabilities?.promptCapabilities?.image !== true) {
      throw new Error("Gemini CLI ACP does not support image input.")
    }
    const session = await request("session/new", { cwd: resolve(cwd), mcpServers: [] })
    if (typeof session?.sessionId !== "string") throw new Error("Gemini CLI ACP did not return a session ID.")
    sessionID = session.sessionId
    const result = await request("session/prompt", { sessionId: sessionID, prompt: [{ type: "text", text: task }, ...images] })
    if (result?.stopReason !== "end_turn") {
      throw new Error("Gemini CLI ACP stopped before completing the request.")
    }
    if (failure) throw failure
  } catch (error) {
    requestFailure = error
  } finally {
    executionSignal.removeEventListener("abort", onAbort)
    lines.close()
    let cleanupFailure
    try {
      await stopProcessTree(child, closeState)
    } catch (cleanupError) {
      cleanupFailure = cleanupError
    }
    requestFailure = requestFailure ?? requestAbortError(signal, timeoutSignal)
    if (cleanupFailure) {
      requestFailure = requestFailure
        ? withCleanupFailure(requestFailure, cleanupFailure)
        : cleanupFailure
    }
  }
  if (requestFailure) throw requestFailure
  return responseText
}
