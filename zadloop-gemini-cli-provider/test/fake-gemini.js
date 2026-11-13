import { createInterface } from "node:readline"

const scenario = process.argv[2]
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const reply = (id, result) => send({ jsonrpc: "2.0", id, result })
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
  } else if (message.method === "session/prompt" && scenario === "empty") {
    reply(message.id, { stopReason: "end_turn" })
  } else if (message.method === "session/prompt" && scenario === "permission") {
    promptId = message.id
    send({ jsonrpc: "2.0", id: 900, method: "session/request_permission", params: { sessionId: "fixture-session", options: [{ optionId: "allow", kind: "allow_once", name: "Allow" }] } })
  } else if (message.id === 900 && promptId) {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Permission denied" } } } })
    reply(promptId, { stopReason: "end_turn" })
  } else if (message.method === "session/prompt" && scenario !== "wait") {
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Fixture " } } } })
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "fixture-session", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "answer" } } } })
    reply(message.id, { stopReason: "end_turn" })
  }
}
