import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { streamAcpImageTask } from "./acp.js"
import {
  geminiFailure,
  geminiOutputLimitFailure,
  geminiProcessFailure,
  geminiProtocolFailure,
  geminiStartupFailure,
} from "./errors.js"
import { readJsonLines } from "./json-lines.js"

const CLI_PROMPT = "Complete the task provided on standard input. Treat it as the user's request."
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const CLEANUP_TIMEOUT_MS = 5000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_ERROR_BYTES = 4 * 1024

export const GEMINI_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", subagentProvider: "gemini" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", subagentProvider: "gemini-pro" },
]

export function validateModel(model) {
  if (model === "default") return GEMINI_MODELS[0].id
  const supportedModel = GEMINI_MODELS.find((candidate) => candidate.id === model)
  if (!supportedModel) throw new Error(`Unsupported Gemini CLI model ID: ${model}`)
  return supportedModel.id
}

function readOutput(handle, stream, maxBytes) {
  const output = handle.collected[stream]?.readFrom(0)
  if (!output) return ""
  if (output.lossy || output.nextOffset > maxBytes) {
    throw geminiOutputLimitFailure(stream, maxBytes)
  }
  return output.text
}

function abortError(signal, timeoutSignal) {
  if (signal?.aborted) return new Error("Gemini task was cancelled.")
  if (timeoutSignal.aborted) return new Error(`Gemini CLI did not finish within ${DEFAULT_TIMEOUT_MS} ms.`)
}

function isInside(directory, parent) {
  const pathFromParent = relative(parent, directory)
  return pathFromParent === "" || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
}

async function awaitWithAbort(operation, signal, getAbortError) {
  if (signal.aborted) throw getAbortError()
  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(getAbortError())
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    const result = await Promise.race([Promise.resolve().then(operation), aborted])
    if (signal.aborted) throw getAbortError()
    return result
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

function createTerminationRequest(getHandle) {
  let terminationRequested = false
  let terminationFailed = false
  return () => {
    const handle = getHandle()
    if (!handle || terminationRequested) return !terminationFailed
    terminationRequested = true
    try {
      handle.terminate()
    } catch {
      terminationFailed = true
    }
    return !terminationFailed
  }
}

async function lookupOutcome(handle, signal, getAbortError) {
  const outcome = await awaitWithAbort(
    () => handle.done.then((value) => ({ value }), (error) => ({ error })),
    signal,
    getAbortError,
  )
  try {
    await awaitWithAbort(() => handle.waitForExit(signal), signal, getAbortError)
  } catch (error) {
    if (outcome.error) throw outcome.error
    throw error
  }
  if (outcome.error) throw outcome.error
  return outcome.value
}

async function terminateCancelledLookup(handle, requestTermination, primary) {
  try {
    await terminateHandle(handle, requestTermination)
  } catch (cleanupError) {
    throw failed(primary, cleanupError)
  }
  throw primary
}

async function runLookup(subprocess, argv, cwd, signal, getAbortError) {
  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: { stdin: "ignore", stdout: { maxBytes: 4096 }, stderr: { maxBytes: MAX_ERROR_BYTES } },
    graceMs: 3000,
    signal,
  })
  const requestTermination = createTerminationRequest(() => handle)

  try {
    const outcome = await lookupOutcome(handle, signal, getAbortError)
    return { outcome, stdout: readOutput(handle, "stdout", 4096), stderr: readOutput(handle, "stderr", MAX_ERROR_BYTES) }
  } catch (error) {
    if (!signal.aborted) throw error
    const abortError = getAbortError()
    const primary = error instanceof Error && error.message !== abortError.message
      ? error
      : abortError
    await terminateCancelledLookup(handle, requestTermination, primary)
  }
}

async function resolveWindowsGemini(subprocess, cwd, signal, getAbortError) {
  const where = await subprocess.resolveExecutable("where.exe", undefined, signal)
  const lookup = await runLookup(subprocess, [where, "gemini.cmd"], cwd, signal, getAbortError)
  const projectDirectory = resolve(cwd)
  const shim = lookup.stdout.split(/\r?\n/).map((path) => path.trim()).find((path) => path && !isInside(dirname(path), projectDirectory))
  if (lookup.outcome.exitCode !== 0 || !shim) {
    throw geminiStartupFailure()
  }
  const node = await subprocess.resolveExecutable("node.exe", undefined, signal)
  const entryPoint = join(dirname(shim), "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
  return { command: node, args: [entryPoint] }
}

async function resolveCommand(subprocess, cwd, signal, getAbortError) {
  const platform = (await subprocess.terminalEnvironment(signal)).platform
  return platform === "windows"
    ? resolveWindowsGemini(subprocess, cwd, signal, getAbortError)
    : { command: await subprocess.resolveExecutable("gemini", undefined, signal), args: [] }
}

function collectStderr(handle) {
  let text = ""
  let bytes = 0
  handle.stderr?.on("data", (chunk) => {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (bytes < MAX_ERROR_BYTES) text += data.subarray(0, MAX_ERROR_BYTES - bytes).toString("utf8")
    bytes += data.length
  })
  handle.stderr?.on("error", () => {})
  return () => text
}

function closeOwnedPipes(handle) {
  if (!handle) return
  for (const pipe of [handle.stdin, handle.stdout, handle.stderr]) {
    if (typeof pipe?.destroy === "function") pipe.destroy()
  }
}

async function terminateHandle(handle, requestTermination) {
  if (!handle) return
  requestTermination()
  const cleanupController = new AbortController()
  const cleanupTimer = setTimeout(() => cleanupController.abort(), CLEANUP_TIMEOUT_MS)
  const cleanupSignal = cleanupController.signal
  let onTimeout
  const timedOut = new Promise((_, reject) => {
    onTimeout = () => reject(new Error("Gemini CLI cleanup failed."))
    cleanupSignal.addEventListener("abort", onTimeout, { once: true })
  })

  try {
    const waits = Promise.all([
      handle.done.catch(() => {}),
      handle.waitForExit(cleanupSignal),
    ])
    await Promise.race([waits, timedOut])
    if (!requestTermination()) throw new Error("Gemini CLI cleanup failed.")
  } catch {
    closeOwnedPipes(handle)
    throw new Error("Gemini CLI cleanup failed.")
  } finally {
    clearTimeout(cleanupTimer)
    cleanupSignal.removeEventListener("abort", onTimeout)
  }
}

async function waitForOutcome(outcome, executionSignal, signal, timeoutSignal) {
  if (executionSignal.aborted) throw abortError(signal, timeoutSignal)
  let onAbort
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError(signal, timeoutSignal))
    executionSignal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([outcome, aborted])
  } finally {
    executionSignal.removeEventListener("abort", onAbort)
  }
}

function failed(primary, cleanupError) {
  if (!cleanupError) return primary
  const cleanup = new Error("Gemini CLI cleanup failed.")
  return new AggregateError([primary, cleanup], `${primary.message} Gemini CLI cleanup also failed.`)
}

/**
 * Run one managed Gemini process. The body owns protocol handling; this
 * wrapper owns abort handling, process termination, and cleanup reporting so
 * text and ACP paths cannot drift on cancellation.
 */
async function* runManagedTask({ subprocess, signal, createSpec, body }) {
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const executionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  let handle
  let failure
  const onAbort = () => {
    closeOwnedPipes(handle)
    requestTermination()
  }
  const requestTermination = createTerminationRequest(() => handle)
  executionSignal.addEventListener("abort", onAbort, { once: true })

  try {
    const spec = await createSpec(executionSignal, () => abortError(signal, timeoutSignal))
    if (executionSignal.aborted) throw abortError(signal, timeoutSignal)
    try {
      handle = subprocess.spawn({ ...spec, graceMs: 3000, signal: executionSignal })
    } catch {
      throw geminiStartupFailure()
    }
    if (executionSignal.aborted) {
      onAbort()
      throw abortError(signal, timeoutSignal)
    }
    yield* body({ handle, signal, executionSignal, timeoutSignal })
  } catch (error) {
    const interrupted = error === executionSignal.reason
      || error?.name === "AbortError"
      || error?.code === "ERR_STREAM_PREMATURE_CLOSE"
    failure = executionSignal.aborted && interrupted
      ? abortError(signal, timeoutSignal)
      : error instanceof Error ? error : new Error(String(error))
  } finally {
    executionSignal.removeEventListener("abort", onAbort)
    try {
      await terminateHandle(handle, requestTermination)
    } catch {
      const cleanupError = new Error("Gemini CLI cleanup failed.")
      const primary = failure ?? abortError(signal, timeoutSignal)
      if (primary) throw failed(primary, cleanupError)
      throw cleanupError
    }
  }
  if (failure) throw failed(failure)
  const aborted = abortError(signal, timeoutSignal)
  if (aborted) throw aborted
}

function assertTask(task) {
  if (typeof task !== "string" || task.trim() === "") throw new Error("Task must not be empty.")
}

function isImageBlock(image) {
  return image?.type === "image"
    && typeof image.data === "string" && image.data !== ""
    && typeof image.mimeType === "string" && image.mimeType !== ""
}

function assertImages(images) {
  if (!Array.isArray(images) || images.length === 0 || !images.every(isImageBlock)) {
    throw new Error("Images must be ACP image content blocks.")
  }
}

function applyStreamEvent(event, state) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw geminiProtocolFailure()
  }
  if (event.type === "message") {
    if (event.role !== "assistant" || typeof event.content !== "string" || !event.content) return undefined
    state.text += event.content
    state.textBytes += Buffer.byteLength(event.content)
    if (state.textBytes > MAX_OUTPUT_BYTES) throw geminiOutputLimitFailure("response text", MAX_OUTPUT_BYTES)
    return event.content
  }
  if (event.type === "result") state.result = event
  else if (event.type === "error") {
    state.lastError = { type: event.severity === "error" ? "ERROR_EVENT" : "WARNING_EVENT", message: event.message }
    if (event.severity === "error" && typeof event.message === "string"
      && /^maximum session turns exceeded$/i.test(event.message.trim())) {
      state.terminalError = new Error("Gemini CLI reached its session turn limit.")
    }
  }
  // init, tool_use, tool_result, and additive event types carry no assistant text.
}

function assertTextResult(state, settled, stderrText) {
  if (settled.error) throw geminiStartupFailure()
  if (!state.result) {
    if (settled.value?.exitCode !== 0) {
      throw geminiFailure({ exitCode: settled.value?.exitCode, signal: settled.value?.signal, stderr: stderrText })
    }
    throw geminiProtocolFailure()
  }
  if (state.result.status !== "success") {
    throw geminiFailure({
      error: state.result.error ?? state.lastError,
      stderr: stderrText,
      exitCode: settled.value?.exitCode,
      signal: settled.value?.signal,
    })
  }
  if (state.terminalError) throw state.terminalError
  if (settled.value?.exitCode !== 0) {
    throw geminiProcessFailure({ exitCode: settled.value?.exitCode, signal: settled.value?.signal })
  }
  if (!state.text.trim()) throw new Error("Gemini CLI returned no response text.")
}

async function* streamTextBody({ handle, signal, executionSignal, timeoutSignal }) {
  const outcome = handle.done.then((value) => ({ value }), (error) => ({ error }))
  const stderr = collectStderr(handle)
  const state = { result: undefined, lastError: undefined, terminalError: undefined, text: "", textBytes: 0 }
  for await (const event of readJsonLines(handle.stdout, { maxBytes: MAX_OUTPUT_BYTES, label: "stdout" })) {
    const chunk = applyStreamEvent(event, state)
    if (chunk) yield chunk
  }
  const settled = await waitForOutcome(outcome, executionSignal, signal, timeoutSignal)
  if (executionSignal.aborted) throw abortError(signal, timeoutSignal)
  assertTextResult(state, settled, stderr())
}

async function* streamImageBody({ handle, task, images, cwd, signal, executionSignal, timeoutSignal }) {
  yield* streamAcpImageTask({ handle, task, images, cwd, signal: executionSignal })
  const aborted = abortError(signal, timeoutSignal)
  if (aborted) throw aborted
}

/**
 * Stream assistant text deltas from one headless Gemini CLI request. The
 * generator owns the process and terminates it when the consumer closes early.
 * A terminal `result` event decides success; warnings before it do not.
 */
export async function* streamGeminiTask({ subprocess, task, cwd, model, signal }) {
  assertTask(task)
  const selectedModel = validateModel(model)
  if (signal?.aborted) throw new Error("Gemini task was cancelled.")
  yield* runManagedTask({
    subprocess,
    signal,
    createSpec: async (executionSignal, getAbortError) => {
      const command = await resolveCommand(
        subprocess,
        cwd,
        executionSignal,
        getAbortError,
      )
      return {
        argv: [
          command.command,
          ...command.args,
          "--prompt",
          CLI_PROMPT,
          "--output-format",
          "stream-json",
          "--approval-mode=yolo",
          "--model",
          selectedModel,
        ],
        cwd,
        stdio: { stdin: { data: task }, stdout: "pipe", stderr: "pipe" },
      }
    },
    body: streamTextBody,
  })
}

/**
 * Stream assistant text deltas from one ACP image request. Images keep the ACP
 * path because headless stream-json has no image input.
 */
export async function* streamGeminiImageTask({ subprocess, task, images, cwd, model, signal }) {
  assertTask(task)
  assertImages(images)
  const selectedModel = validateModel(model)
  if (signal?.aborted) throw new Error("Gemini task was cancelled.")
  yield* runManagedTask({
    subprocess,
    signal,
    createSpec: async (executionSignal, getAbortError) => {
      const command = await resolveCommand(
        subprocess,
        cwd,
        executionSignal,
        getAbortError,
      )
      return {
        argv: [command.command, ...command.args, "--acp", "--approval-mode=yolo", "--model", selectedModel],
        cwd,
        stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      }
    },
    body: (context) => streamImageBody({ ...context, task, images, cwd }),
  })
}

export async function runGeminiTask(options) {
  let text = ""
  for await (const chunk of streamGeminiTask(options)) text += chunk
  return text
}
