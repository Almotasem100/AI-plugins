// A fake process boundary, not a Gemini CLI or ACP/MCP implementation.
process.on("message", (message) => {
  if (message.type === "prompt") {
    if (message.tools.some((item) => item.name === "wait")) return
    const tool = message.tools.find((item) => item.name === "example_read")
    if (!tool) return process.send({ type: "error" })
    process.send({ type: "tool-call", id: "call-1", name: tool.name, input: { path: "example.txt" } })
  } else if (message.type === "result" && message.id === "call-1") {
    process.send({ type: "text", text: `Agent received: ${message.output.value}` })
  }
})
