import { randomUUID } from "node:crypto"
import { runGeminiTask } from "./gemini.js"
import { renderSubagentPrompt } from "./prompt.js"

export function createGeminiSubagent({ subprocess, name, model }) {
  return {
    name,
    capabilities: {
      agentOptions: false,
      agentPreset: false,
      outputSchema: false,
      depthLimit: true,
    },
    inheritsParentContext: false,

    async start(request) {
      const controller = new AbortController()
      const abortFromParent = () => controller.abort(request.signal.reason)
      if (request.signal.aborted) abortFromParent()
      else request.signal.addEventListener("abort", abortFromParent, { once: true })

      const result = (async () => {
        try {
          const output = await runGeminiTask({
            subprocess,
            task: renderSubagentPrompt(request.prompt),
            cwd: request.cwd,
            model,
            signal: controller.signal,
          })
          return {
            output: output ? [{ type: "text", text: output }] : [],
            stopReason: "completed",
          }
        } catch (error) {
          if (controller.signal.aborted) return { output: [], stopReason: "aborted" }
          return {
            output: [],
            diagnostic: error instanceof Error ? error.message : String(error),
            stopReason: "error",
          }
        } finally {
          request.signal.removeEventListener("abort", abortFromParent)
        }
      })()

      return {
        id: `session-${randomUUID()}`,
        result,
        async dispose() {
          controller.abort(new Error("Gemini delegation was disposed."))
          await result
        },
      }
    },
  }
}
