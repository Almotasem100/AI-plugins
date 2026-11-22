import {
  geminiFailure,
  geminiOutputLimitFailure,
  geminiProcessFailure,
  geminiProtocolFailure,
} from "./errors.js"
import { readJsonLines } from "./json-lines.js"

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_ERROR_BYTES = 4 * 1024

function createTextQueue() {
  const values = []
  let failure
  let ended = false
  let wake
  const notify = () => {
    const resume = wake
    wake = undefined
    resume?.()
  }
  return {
    push(text) {
      if (failure || ended) return
      values.push(text)
      notify()
    },
    end() {
      if (failure || ended) return
      ended = true
      notify()
    },
    fail(error) {
      if (failure || ended) return
      failure = error
      notify()
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (values.length) yield values.shift()
        if (failure) throw failure
        if (ended) return
        await new Promise((resolve) => { wake = resolve })
      }
    },
  }
}

async function runAcpSession({ handle, task, images, cwd, signal, getAbortError, onText }) {
  const { stdin, stdout, stderr } = handle
  if (!stdin || !stdout || !stderr) throw geminiProtocolFailure()
  const pending = new Map()
  let nextId = 0
  let failure
  let text = ""
  let textBytes = 0
  let stderrText = ""
  let stderrBytes = 0
  let sessionId
  let promptFinished = false

  const fail = (error) => {
    if (failure) return
    failure = error instanceof Error ? error : new Error(String(error))
    for (const entry of pending.values()) entry.reject(failure)
    pending.clear()
  }
  const send = (message) => {
    if (failure) throw failure
    stdin.write(`${JSON.stringify(message)}\n`, (error) => { if (error) fail(geminiProcessFailure({ stderr: error.message })) })
  }
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    if (failure) return reject(failure)
    const id = ++nextId
    pending.set(id, { resolve: resolveRequest, reject })
    try { send({ jsonrpc: "2.0", id, method, params }) } catch (error) { fail(error) }
  })
  const processLine = (message) => {
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
      throw geminiProtocolFailure()
    }
    if (typeof message.method === "string") {
      if (Object.hasOwn(message, "id")) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method unavailable" } })
      } else if (message.method === "session/update" && message.params?.sessionId === sessionId) {
        const update = message.params.update
        if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          if (typeof update.content.text !== "string") throw geminiProtocolFailure()
          if (!update.content.text) return
          text += update.content.text
          textBytes += Buffer.byteLength(update.content.text)
          if (textBytes > MAX_OUTPUT_BYTES) throw geminiOutputLimitFailure("response text", MAX_OUTPUT_BYTES)
          onText(update.content.text)
        }
      }
      return
    }
    if (!Object.hasOwn(message, "id") || !pending.has(message.id)) {
      throw geminiProtocolFailure()
    }
    const entry = pending.get(message.id)
    pending.delete(message.id)
    if (Object.hasOwn(message, "error")) entry.reject(geminiFailure({ error: message.error }))
    else if (Object.hasOwn(message, "result")) entry.resolve(message.result)
    else entry.reject(geminiProtocolFailure())
  }
  const onAbort = () => fail(getAbortError?.() ?? new Error("Gemini task was cancelled."))
  stderr.on("data", (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    if (stderrBytes < MAX_ERROR_BYTES) stderrText += bytes.subarray(0, MAX_ERROR_BYTES - stderrBytes).toString("utf8")
    stderrBytes += bytes.length
  })
  stderr.on("error", () => {})
  stdout.on("error", (error) => fail(geminiProcessFailure({ stderr: error.message })))
  stdin.on("error", (error) => fail(geminiProcessFailure({ stderr: error.message })))
  handle.done.then(
    (outcome) => { if (!promptFinished) fail(geminiProcessFailure({ ...outcome, stderr: stderrText })) },
    (error) => fail(geminiProcessFailure({ stderr: error instanceof Error ? error.message : String(error) })),
  )
  signal.addEventListener("abort", onAbort, { once: true })
  if (signal.aborted) onAbort()

  const reading = (async () => {
    for await (const message of readJsonLines(stdout, { maxBytes: MAX_OUTPUT_BYTES, label: "ACP stdout" })) {
      if (failure) break
      processLine(message)
    }
    if (!failure && !promptFinished) fail(geminiProtocolFailure())
  })()
  reading.catch(fail)

  try {
    if (failure) throw failure
    const init = await request("initialize", { protocolVersion: 1, clientCapabilities: {} })
    if (init?.protocolVersion !== 1 || init.agentCapabilities?.promptCapabilities?.image !== true) {
      throw new Error("Gemini CLI ACP does not support image input.")
    }
    const session = await request("session/new", { cwd, mcpServers: [] })
    if (typeof session?.sessionId !== "string" || !session.sessionId) throw geminiProtocolFailure()
    sessionId = session.sessionId
    const result = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: task }, ...images] })
    promptFinished = true
    if (signal.aborted) onAbort()
    if (failure) throw failure
    if (result?.stopReason !== "end_turn") {
      throw new Error("Gemini CLI ACP stopped before completing the request.")
    }
    if (!text.trim()) throw new Error("Gemini CLI ACP returned no response text.")
    return text
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

/**
 * Stream text chunks from one ACP image request. The owning task manages the
 * process; closing this generator early aborts the ACP session and terminates
 * the process so no work continues behind a closed consumer.
 */
export async function* streamAcpImageTask({ handle, task, images, cwd, signal, getAbortError }) {
  const controller = new AbortController()
  const executionSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const queue = createTextQueue()
  const core = runAcpSession({
    handle,
    task,
    images,
    cwd,
    signal: executionSignal,
    getAbortError,
    onText: (chunk) => queue.push(chunk),
  })
  core.then(() => queue.end(), (error) => queue.fail(error))
  try {
    for await (const chunk of queue) yield chunk
    await core
  } finally {
    controller.abort(new Error("Gemini CLI ACP stream closed."))
    await core.catch(() => {})
  }
}
