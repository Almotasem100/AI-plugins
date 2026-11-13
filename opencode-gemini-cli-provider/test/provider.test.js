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

test("language model forwards the selected concrete model ID to Gemini CLI", async () => {
  for (const modelID of ["gemini-3.8-flash", "gemini-3.1-pro-preview"]) {
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
    assert.equal(received.model, modelID)
    assert.match(received.task, /"text": "Hello"/)
    assert.equal(generatedResponse.content[0].text, "The answer")
    assert.equal(generatedResponse.finishReason.unified, "stop")
  }
})

test("stream adapter emits a complete AI SDK V3 text response", async () => {
  const model = createGeminiLanguageModel({
    modelID: "gemini-3.8-flash",
    cwd: "C:/project",
    run: async () => "Streamed after completion",
  })
  const { stream } = await model.doStream({ prompt: [{ role: "user", content: "Hello" }] })
  const events = []
  for await (const event of stream) events.push(event)

  assert.deepEqual(events.map((event) => event.type), ["stream-start", "text-start", "text-delta", "text-end", "finish"])
  assert.equal(events[2].delta, "Streamed after completion")
})

test("non-image prompt content fails instead of being silently dropped", () => {
  assert.throws(
    () => renderGeminiPrompt([{ role: "user", content: [{ type: "file", data: "AA==", mediaType: "application/pdf" }] }]),
    /does not support application\/pdf/,
  )
})

test("screenshots are forwarded as image data with their conversation position", async () => {
  let received
  const model = createGeminiLanguageModel({ modelID: "gemini-3.8-flash", cwd: "C:/project", runImage: async (input) => {
    received = input
    return "image received"
  } })
  const result = await model.doGenerate({ prompt: [{ role: "user", content: [
    { type: "text", text: "Describe this" },
    { type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
  ] }] })
  assert.equal(result.content[0].text, "image received")
  assert.deepEqual(received.images, [{ type: "image", mimeType: "image/png", data: "AQID" }])
  assert.match(received.task, /Attached image 1/)
})

test("image URLs are rejected rather than being sent as base64", () => {
  assert.throws(() => renderGeminiPrompt([{ role: "user", content: [
    { type: "file", mediaType: "image/png", data: new URL("https://example.com/image.png") },
  ] }]), /requires image bytes or base64/)
})
