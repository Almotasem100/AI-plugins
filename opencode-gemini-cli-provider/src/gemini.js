import { spawn } from "node:child_process"
import { once } from "node:events"
import { access, constants } from "node:fs/promises"
import { delimiter, isAbsolute, join, relative, resolve, sep } from "node:path"
import { homedir } from "node:os"
import { createInterface } from "node:readline"

const CLI_PROMPT = "Complete the task provided on standard input. Treat it as the user's request."
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_ERROR_CHARS = 4_000
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

export function validateModel(model) {
  if (model === undefined || model === "") return undefined
  if (typeof model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(model)) {
    throw new Error("Model must be a Gemini CLI model ID containing only letters, numbers, '.', '_' or '-'.")
  }
  return model
}

export function parseGeminiOutput(stdout, stderr = "") {
  let cliOutput
  try {
    cliOutput = JSON.parse(stdout)
  } catch {
    const detail = stderr.trim()
    throw new Error(
      `Gemini CLI returned invalid JSON.${detail ? ` ${detail.slice(0, MAX_ERROR_CHARS)}` : ""}`,
    )
  }

  if (cliOutput?.error) {
    const message = typeof cliOutput.error === "string" ? cliOutput.error : cliOutput.error.message
    throw new Error(message || "Gemini CLI reported an error.")
  }
  if (typeof cliOutput?.response !== "string") {
    throw new Error("Gemini CLI JSON output did not contain a response string.")
  }

  return cliOutput.response
}

function terminate(child) {
  if (!child.pid) {
    child.kill()
    return
  }

  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? "C:\\Windows"
    const taskkill = join(systemRoot, "System32", "taskkill.exe")
    const killer = spawn(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    })
    killer.on("error", () => child.kill())
    return
  }

  signalProcessGroup(child, "SIGTERM")
}

function signalProcessGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

function trackClose(child) {
  const state = { complete: false }
  state.promise = new Promise((resolve) => {
    child.once("close", (...event) => {
      state.complete = true
      resolve(event)
    })
  })
  return state
}

async function stopProcessTree(child, closeState) {
  if (!child.pid) {
    if (!closeState.complete) await closeState.promise
    return
  }
  terminate(child)
  if (process.platform === "win32") {
    if (!closeState.complete) await closeState.promise
    return
  }
  await waitForProcessGroup(child.pid)
  if (isProcessGroupAlive(child.pid)) signalProcessGroup(child, "SIGKILL")
  if (!closeState.complete) await closeState.promise
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

function collectStdout(stream) {
  return new Promise((resolve, reject) => {
    let text = ""
    let bytes = 0
    let failed = false
    stream.setEncoding("utf8")
    stream.on("data", (chunk) => {
      if (failed) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > MAX_OUTPUT_BYTES) {
        failed = true
        reject(new Error("Gemini CLI output exceeded the 16 MiB limit."))
        return
      }
      text += chunk
    })
    stream.on("end", () => resolve(text))
    stream.on("error", reject)
  })
}

function collectStderr(stream) {
  return new Promise((resolve, reject) => {
    let text = ""
    stream.setEncoding("utf8")
    stream.on("data", (chunk) => {
      if (text.length < MAX_ERROR_CHARS) text += chunk.slice(0, MAX_ERROR_CHARS - text.length)
    })
    stream.on("end", () => resolve(text))
    stream.on("error", reject)
  })
}

async function collectCliResponse(context) {
  try {
    const [[exitCode], stdout, stderr] = await Promise.all([
      once(context.child, "close", { signal: context.executionSignal }),
      context.stdoutPromise,
      context.stderrPromise,
    ])
    if (exitCode !== 0) throw new Error(`Gemini CLI exited with code ${exitCode}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`)
    return parseGeminiOutput(stdout, stderr)
  } catch (error) {
    await stopProcessTree(context.child, context.closeState)
    if (context.signal?.aborted) throw new Error("Gemini task was cancelled.")
    if (context.timeoutSignal.aborted) throw new Error(`Gemini CLI did not finish within ${DEFAULT_TIMEOUT_MS} ms.`)
    throw error
  }
}

async function readGeminiProcess(child, task, signal) {
  const closeState = trackClose(child)
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  child.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") terminate(child)
  })
  child.stdin.end(task)

  return collectCliResponse({
    child,
    closeState,
    signal,
    timeoutSignal,
    executionSignal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    stdoutPromise: collectStdout(child.stdout),
    stderrPromise: collectStderr(child.stderr),
  })
}

export async function runGeminiTask({ task, cwd, model, signal }) {
  if (typeof task !== "string" || task.trim() === "") {
    throw new Error("Task must not be empty.")
  }
  const selectedModel = validateModel(model)
  const args = ["--prompt", CLI_PROMPT, "--output-format", "json", "--approval-mode=yolo"]
  if (selectedModel) args.push("--model", selectedModel)
  if (signal?.aborted) throw new Error("Gemini task was cancelled.")

  const cli = await resolveGeminiCommand(cwd)
  const child = spawn(cli.command, [...cli.args, ...args], {
    cwd,
    detached: process.platform !== "win32",
    env: process.env,
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  })
  return readGeminiProcess(child, task, signal)
}

// Images use ACP because headless JSON output accepts only a text prompt.
export async function runGeminiImageTask({ task, images, cwd, model, signal }) {
  const selectedModel = validateModel(model)
  if (signal?.aborted) throw new Error("Gemini task was cancelled.")
  const cli = await resolveGeminiCommand(cwd)
  const args = ["--acp", "--approval-mode=yolo"]
  if (selectedModel) args.push("--model", selectedModel)
  const child = spawn(cli.command, [...cli.args, ...args], {
    cwd, detached: process.platform !== "win32", env: process.env, shell: false,
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  })
  const closeState = trackClose(child)
  const stderrPromise = collectStderr(child.stderr)
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const executionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const pending = new Map()
  let nextID = 0
  let responseText = ""
  let responseBytes = 0
  let failure
  const fail = (error) => {
    if (failure) return
    failure = error
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
  }
  const onAbort = () => fail(new Error(signal?.aborted ? "Gemini task was cancelled." : `Gemini CLI did not finish within ${DEFAULT_TIMEOUT_MS} ms.`))
  executionSignal.addEventListener("abort", onAbort, { once: true })
  child.on("error", fail)
  child.stdin.on("error", fail)
  child.on("close", () => fail(new Error("Gemini CLI ACP process closed unexpectedly.")))
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line)
      if (message.method === "session/update") {
        const update = message.params?.update
        if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          responseBytes += Buffer.byteLength(update.content.text)
          if (responseBytes > MAX_OUTPUT_BYTES) throw new Error("Gemini CLI output exceeded the 16 MiB limit.")
          responseText += update.content.text
        }
      } else if (message.method && message.id !== undefined) {
        // Never auto-approve a request we cannot display through OpenCode.
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method unavailable" } })}\n`)
      } else if (message.id !== undefined && pending.has(message.id)) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message || "Gemini CLI ACP request failed."))
        else entry.resolve(message.result)
      }
    } catch (error) { fail(error) }
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    if (failure) return reject(failure)
    const id = ++nextID
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })
  try {
    if (executionSignal.aborted) onAbort()
    const init = await request("initialize", { protocolVersion: 1, clientCapabilities: {} })
    if (init?.protocolVersion !== 1 || init.agentCapabilities?.promptCapabilities?.image !== true) {
      throw new Error("Gemini CLI ACP does not support image input.")
    }
    const session = await request("session/new", { cwd: resolve(cwd), mcpServers: [] })
    if (typeof session?.sessionId !== "string") throw new Error("Gemini CLI ACP did not return a session ID.")
    const result = await request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: task }, ...images] })
    if (result?.stopReason !== "end_turn") throw new Error(`Gemini CLI ACP stopped: ${result?.stopReason ?? "unknown"}.`)
    return responseText
  } finally {
    executionSignal.removeEventListener("abort", onAbort)
    lines.close()
    await stopProcessTree(child, closeState)
    await stderrPromise.catch(() => {})
  }
}
