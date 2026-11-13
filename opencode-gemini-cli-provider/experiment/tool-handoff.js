// Offline experiment only: the child uses a deliberately simplified IPC protocol,
// not Gemini ACP or MCP. Nothing in the registered provider imports this file.
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"

const fixture = fileURLToPath(new URL("./fake-agent.cjs", import.meta.url))
const usage = {
  inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: undefined, reasoning: undefined },
}

export function createHandoffExperiment() {
  const child = fork(fixture, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] })
  let state = "new"
  let pendingID

  function stop() {
    if (state === "closed") return
    state = "closed"
    child.kill()
  }

  function exchange(message, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        stop()
        reject(new Error("Cancelled"))
        return
      }
      const cleanup = () => {
        child.off("message", onMessage)
        child.off("exit", onExit)
        child.off("error", onError)
        signal?.removeEventListener("abort", onAbort)
      }
      const fail = (error) => { cleanup(); stop(); reject(error) }
      const onMessage = (response) => { cleanup(); resolve(response) }
      const onExit = () => fail(new Error("Fake agent exited"))
      const onError = (error) => fail(error)
      const onAbort = () => fail(new Error("Cancelled"))
      child.once("message", onMessage)
      child.once("exit", onExit)
      child.once("error", onError)
      signal?.addEventListener("abort", onAbort, { once: true })
      child.send(message, (error) => { if (error) fail(error) })
    })
  }

  return {
    close: stop,
    async doStream(options) {
      if (state !== "new" && state !== "waiting") throw new Error(`Invalid experiment state: ${state}`)
      let message
      if (state === "new") {
        const tools = (options.tools ?? []).filter((tool) => tool.type === "function")
        message = { type: "prompt", tools }
      } else {
        const results = options.prompt.flatMap((item) => Array.isArray(item.content) ? item.content : [])
        const result = results.find((part) => part.type === "tool-result" && part.toolCallId === pendingID)
        if (!result) throw new Error("Missing pending tool result")
        message = { type: "result", id: pendingID, output: result.output }
      }
      state = "running"
      let response
      try {
        response = await exchange(message, options.abortSignal)
      } catch (error) {
        stop()
        throw error
      }
      const events = [{ type: "stream-start", warnings: [] }]
      if (response.type === "tool-call") {
        pendingID = response.id
        state = "waiting"
        events.push({ type: "tool-call", toolCallId: response.id, toolName: response.name, input: JSON.stringify(response.input) })
        events.push({ type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage })
      } else if (response.type === "text") {
        events.push({ type: "text-start", id: "answer" })
        events.push({ type: "text-delta", id: "answer", delta: response.text })
        events.push({ type: "text-end", id: "answer" })
        events.push({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage })
        stop()
      } else {
        stop()
        throw new Error("Unexpected fake agent response")
      }
      return { stream: new ReadableStream({ start(controller) { for (const event of events) controller.enqueue(event); controller.close() } }) }
    },
  }
}
