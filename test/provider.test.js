import assert from "node:assert/strict"
import test from "node:test"
import { createGeminiLanguageModel, renderGeminiPrompt } from "../src/provider.js"

test("renderGeminiPrompt preserves message roles and tool results", () => {
  const prompt = renderGeminiPrompt([
    { role: "system", content: "Be concise." },
    { role: "user", content: [{ type: "text", text: "Read a file." }] },
    {
      role: "assistant",
      content: [
        { type: "tool-call", toolName: "read", input: { filePath: "README.md" } },
        { type: "tool-result", toolName: "read", output: { type: "text", value: "# Project" } },
      ],
    },
  ])

  const transcript = JSON.parse(prompt.split("\n\n")[1])
  assert.deepEqual(transcript.map((message) => message.role), ["system", "user", "assistant"])
  assert.equal(transcript[0].text, "Be concise.")
  assert.equal(transcript[1].text, "Read a file.")
  assert.match(transcript[2].text, /OpenCode tool call read/)
  assert.match(transcript[2].text, /OpenCode tool result read/)
})

test("language model forwards concrete model IDs and delegates default selection to Gemini CLI", async () => {
  for (const { modelID, expectedModel } of [
    { modelID: "gemini-2.5-pro", expectedModel: "gemini-2.5-pro" },
    { modelID: "default", expectedModel: undefined },
  ]) {
    let received
    const model = createGeminiLanguageModel({
      modelID,
      cwd: "C:/project",
      run: async (input) => {
        received = input
        return "The answer"
      },
    })

    const generatedResponse = await model.doGenerate({ prompt: [{ role: "user", content: "Hello" }] })

    assert.equal(received.cwd, "C:/project")
    assert.equal(received.model, expectedModel)
    assert.match(received.task, /"text": "Hello"/)
    assert.equal(generatedResponse.content[0].text, "The answer")
    assert.equal(generatedResponse.finishReason.unified, "stop")
  }
})

test("stream adapter emits a complete AI SDK V3 text response", async () => {
  const model = createGeminiLanguageModel({
    modelID: "default",
    cwd: "C:/project",
    run: async () => "Streamed after completion",
  })
  const { stream } = await model.doStream({ prompt: [{ role: "user", content: "Hello" }] })
  const events = []
  for await (const event of stream) events.push(event)

  assert.deepEqual(events.map((event) => event.type), ["stream-start", "text-start", "text-delta", "text-end", "finish"])
  assert.equal(events[2].delta, "Streamed after completion")
})

test("unsupported prompt content fails instead of being silently dropped", () => {
  assert.throws(
    () => renderGeminiPrompt([{ role: "user", content: [{ type: "file", data: "AA==", mediaType: "image/png" }] }]),
    /does not support file prompt content/,
  )
})
