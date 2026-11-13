import assert from "node:assert/strict"
import test from "node:test"
import { createHandoffExperiment } from "../experiment/tool-handoff.js"

async function collect(result) {
  const events = []
  for await (const event of result.stream) events.push(event)
  return events
}

test("fake agent receives the host tool result after a tool-call continuation", async (t) => {
  const model = createHandoffExperiment()
  t.after(() => model.close())
  const tools = [{ type: "function", name: "example_read", inputSchema: { type: "object" } }]
  const first = await collect(await model.doStream({ prompt: [], tools }))
  const call = first.find((event) => event.type === "tool-call")
  assert.equal(first.at(-1).finishReason.unified, "tool-calls")
  assert.equal(call.toolName, "example_read")
  assert.deepEqual(JSON.parse(call.input), { path: "example.txt" })

  // Simulate OpenCode executing the offered tool and returning its structured result.
  const second = await collect(await model.doStream({ prompt: [{ role: "tool", content: [
    { type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: { type: "text", value: "file contents" } },
  ] }] }))
  assert.equal(second.find((event) => event.type === "text-delta").delta, "Agent received: file contents")
  assert.equal(second.at(-1).finishReason.unified, "stop")
})

test("cancelling an in-flight exchange stops without producing a tool call", async (t) => {
  const model = createHandoffExperiment()
  t.after(() => model.close())
  const controller = new AbortController()
  const pending = model.doStream({ prompt: [], tools: [{ type: "function", name: "wait" }], abortSignal: controller.signal })
  controller.abort()
  await assert.rejects(pending, /Cancelled/)
})

test("a rejected tool result is returned to the fake agent without retrying the tool", async (t) => {
  const model = createHandoffExperiment()
  t.after(() => model.close())
  const first = await collect(await model.doStream({ prompt: [], tools: [{ type: "function", name: "example_read" }] }))
  const call = first.find((event) => event.type === "tool-call")
  const second = await collect(await model.doStream({ prompt: [{ role: "tool", content: [
    { type: "tool-result", toolCallId: call.toolCallId, toolName: call.toolName, output: { type: "error-text", value: "Permission denied" } },
  ] }] }))
  assert.equal(second.find((event) => event.type === "text-delta").delta, "Agent received: Permission denied")
  assert.equal(second.at(-1).finishReason.unified, "stop")
})
