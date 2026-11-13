import { StringDecoder } from "node:string_decoder"

const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_ERROR_BYTES = 4 * 1024

// ACP uses one JSON-RPC message per line. All streams belong to the managed handle.
export async function runAcpImageTask({ handle, task, images, cwd, signal }) {
  const { stdin, stdout, stderr } = handle
  const pending = new Map()
  let nextId = 0
  let failure
  let text = ""
  let sessionId
  let stdoutBytes = 0
  let stderrBytes = 0
  let stderrText = ""
  let buffer = ""
  const decoder = new StringDecoder("utf8")

  const fail = (error) => {
    if (failure) return
    failure = error instanceof Error ? error : new Error(String(error))
    for (const entry of pending.values()) entry.reject(failure)
    pending.clear()
  }
  const send = (message) => {
    if (failure) throw failure
    stdin.write(`${JSON.stringify(message)}\n`, (error) => { if (error) fail(error) })
  }
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    if (failure) return reject(failure)
    const id = ++nextId
    pending.set(id, { resolve: resolveRequest, reject })
    try { send({ jsonrpc: "2.0", id, method, params }) } catch (error) { fail(error) }
  })
  const processLine = (line) => {
    if (!line.trim()) return
    const message = JSON.parse(line)
    if (!message || typeof message !== "object" || Array.isArray(message) || message.jsonrpc !== "2.0") {
      throw new Error("Gemini CLI returned an invalid ACP message.")
    }
    if (typeof message.method === "string") {
      if (Object.hasOwn(message, "id")) {
        send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Client method unavailable" } })
      } else if (message.method === "session/update" && message.params?.sessionId === sessionId) {
        const update = message.params.update
        if (update?.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
          if (typeof update.content.text !== "string") throw new Error("Gemini CLI returned an invalid ACP text chunk.")
          text += update.content.text
        }
      }
      return
    }
    if (!Object.hasOwn(message, "id") || !pending.has(message.id)) throw new Error("Gemini CLI returned an unexpected ACP response.")
    const entry = pending.get(message.id)
    pending.delete(message.id)
    if (Object.hasOwn(message, "error")) entry.reject(new Error(message.error?.message || "Gemini CLI ACP request failed."))
    else if (Object.hasOwn(message, "result")) entry.resolve(message.result)
    else entry.reject(new Error("Gemini CLI returned an invalid ACP response."))
  }
  const onData = (chunk) => {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      stdoutBytes += bytes.length
      if (stdoutBytes > MAX_OUTPUT_BYTES) throw new Error("Gemini CLI stdout exceeded the 16 MiB output limit.")
      buffer += decoder.write(bytes)
      let newline
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        processLine(line)
      }
    } catch (error) { fail(error) }
  }
  const onAbort = () => fail(new Error("Gemini task was cancelled."))
  const onEnd = () => {
    try {
      buffer += decoder.end()
      if (buffer.trim()) throw new Error("Gemini CLI returned an incomplete ACP message.")
      fail(new Error("Gemini CLI ACP output closed unexpectedly."))
    } catch (error) { fail(error) }
  }
  try {
    if (!stdin || !stdout || !stderr) throw new Error("Gemini CLI ACP requires subprocess pipes.")
    stdin.on("error", fail)
    stdout.on("error", fail)
    stderr.on("error", fail)
    stdout.on("data", onData)
    stdout.on("end", onEnd)
    stderr.on("data", (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (stderrBytes < MAX_ERROR_BYTES) stderrText += bytes.subarray(0, MAX_ERROR_BYTES - stderrBytes).toString("utf8")
      stderrBytes += bytes.length
    })
    handle.done.then((outcome) => fail(new Error(`Gemini CLI ACP process exited with code ${outcome.exitCode}.${stderrText.trim() ? ` ${stderrText.trim()}` : ""}`)), fail)
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
    const init = await request("initialize", { protocolVersion: 1, clientCapabilities: {} })
    if (init?.protocolVersion !== 1 || init.agentCapabilities?.promptCapabilities?.image !== true) {
      throw new Error("Gemini CLI ACP does not support image input.")
    }
    const session = await request("session/new", { cwd, mcpServers: [] })
    if (typeof session?.sessionId !== "string" || !session.sessionId) throw new Error("Gemini CLI ACP did not return a session ID.")
    sessionId = session.sessionId
    const result = await request("session/prompt", { sessionId, prompt: [{ type: "text", text: task }, ...images] })
    if (signal.aborted) onAbort()
    if (failure) throw failure
    if (result?.stopReason !== "end_turn") throw new Error(`Gemini CLI ACP stopped: ${result?.stopReason ?? "unknown"}.`)
    if (!text.trim()) throw new Error("Gemini CLI ACP returned no response text.")
    return text
  } finally {
    signal.removeEventListener("abort", onAbort)
    try {
      await handle.terminate()
    } finally {
      await Promise.all([handle.done.catch(() => {}), handle.waitForExit()])
    }
  }
}
