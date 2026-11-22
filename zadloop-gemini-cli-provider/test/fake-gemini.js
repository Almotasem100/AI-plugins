import { createInterface } from "node:readline"

const scenario = process.argv[2]
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const reply = (id, result) => send({ jsonrpc: "2.0", id, result })
const streamMessage = (content) => send({ type: "message", timestamp: new Date().toISOString(), role: "assistant", content, delta: true })
const streamResult = (status = "success", error) => send({ type: "result", timestamp: new Date().toISOString(), status, ...(error ? { error } : {}), stats: {} })
const waitForWake = () => new Promise((resolve) => process.once("message", resolve))

function writeSplitLine(value) {
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`)
  const emoji = Buffer.from("😀")
  const index = bytes.indexOf(emoji)
  const split = index >= 0 ? index + 2 : Math.floor(bytes.length / 2)
  process.stdout.write(bytes.subarray(0, split))
  process.stdout.write(bytes.subarray(split))
}

async function runHeadless() {
  switch (scenario) {
    case "stream-success": {
      writeSplitLine({ type: "init", timestamp: new Date().toISOString(), session_id: "fixture-stream", model: "fixture-model" })
      writeSplitLine({ type: "message", timestamp: new Date().toISOString(), role: "assistant", content: "Fixture 😀", delta: true })
      await waitForWake()
      streamMessage(" answer")
      streamResult()
      return
    }
    case "stream-warning": {
      send({ type: "message", timestamp: new Date().toISOString(), role: "user", content: "ignored input" })
      send({ type: "error", timestamp: new Date().toISOString(), severity: "error", message: "Recoverable warning only" })
      streamMessage("Warning survived")
      streamResult()
      return
    }
    case "stream-max-turn": {
      streamMessage("Partial response")
      send({ type: "error", timestamp: new Date().toISOString(), severity: "error", message: "Maximum session turns exceeded" })
      streamResult()
      return
    }
    case "stream-error-after-text": {
      streamMessage("Partial")
      streamResult("error", { type: "FatalAuthenticationError", message: "Sign in first. Key AIzaFixtureSecretValue1234567890" })
      return
    }
    case "stream-secret": {
      streamResult("error", {
        type: "FatalError",
        message: 'Request failed for https://example.test/?key=url-query-secret&token=second-query-secret and password: "synthetic secret phrase" and Authorization: Bearer fixture-bearer-secret',
      })
      return
    }
    case "stream-empty": {
      streamResult()
      return
    }
    case "stream-malformed": {
      process.stdout.write("not-json\n")
      return
    }
    case "stream-incomplete": {
      process.stdout.write(JSON.stringify({ type: "message", role: "assistant", content: "Cut off", delta: true }))
      return
    }
    case "stream-no-result": {
      streamMessage("Partial")
      return
    }
    case "stream-nonzero": {
      streamMessage("Complete text")
      streamResult()
      process.exitCode = 3
      return
    }
    case "stream-auth-stderr": {
      process.stderr.write("Authentication required. Sign in to continue.\n")
      process.exitCode = 1
      return
    }
    case "stream-quota": {
      streamResult("error", { type: "RESOURCE_EXHAUSTED", message: "Quota exceeded for this project." })
      process.exitCode = 1
      return
    }
    case "stream-slow": {
      streamMessage("First")
      await waitForWake()
      streamMessage(" second")
      streamResult()
      return
    }
    case "stream-upstream-cancel": {
      streamMessage("Partial")
      streamResult("error", { type: "ERROR_EVENT", message: "rpc error: code = Canceled desc = context canceled" })
      process.exitCode = 1
      return
    }
    default:
      throw new Error(`Unknown headless scenario: ${scenario}`)
  }
}

async function runAcp() {
  let promptId
  for await (const line of createInterface({ input: process.stdin })) {
    const message = JSON.parse(line)
    process.send?.(message)
    if (message.method === "initialize") {
      reply(message.id, { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: scenario !== "unsupported" } } })
    } else if (message.method === "session/new") {
      reply(message.id, { sessionId: "fixture-session" })
    } else if (message.method === "session/prompt" && scenario === "malformed") {
      process.stdout.write("not-json\n")
    } else if (message.method === "session/prompt" && scenario === "error") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "fixture ACP failure" } })
    } else if (message.method === "session/prompt" && scenario === "secret-error") {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: 'denied for password: "synthetic secret phrase" at https://example.test/?key=url-query-secret' } })
    } else if (message.method === "session/prompt" && scenario === "partial-error") {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Partial" } } } })
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "fixture failure after text" } })
    } else if (message.method === "session/prompt" && scenario === "empty") {
      reply(message.id, { stopReason: "end_turn" })
    } else if (message.method === "session/prompt" && scenario === "unsafe-stop-reason") {
      reply(message.id, { stopReason: `denied\nAIzaFixtureSecretValue1234567890 ${"x".repeat(1000)}` })
    } else if (message.method === "session/prompt" && scenario === "permission") {
      promptId = message.id
      send({ jsonrpc: "2.0", id: 900, method: "session/request_permission", params: { sessionId: "fixture-session", options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }] } })
    } else if (message.id === 900 && promptId) {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Permission denied" } } } })
      reply(promptId, { stopReason: "end_turn" })
    } else if (message.method === "session/prompt" && scenario === "split") {
      writeSplitLine({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Grüße 😀" } } } })
      reply(message.id, { stopReason: "end_turn" })
    } else if (message.method === "session/prompt" && scenario === "slow") {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "First" } } } })
      await waitForWake()
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " second" } } } })
      reply(message.id, { stopReason: "end_turn" })
    } else if (message.method === "session/prompt" && scenario !== "wait") {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Fixture " } } } })
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } } } })
      reply(message.id, { stopReason: "end_turn" })
    }
  }
}

if (scenario.startsWith("stream-")) await runHeadless()
else await runAcp()
