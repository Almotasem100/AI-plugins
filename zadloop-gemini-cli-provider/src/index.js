import { GeminiCliAdapter } from "./adapter.js"
import { createGeminiSubagent } from "./delegation.js"
import { GEMINI_MODELS } from "./gemini.js"

export const inject = ["llm", "subprocess", "sessions", "workingDirectory", "subagents"]

export function apply(ctx) {
  const adapterDisposer = ctx.llm.registerAdapter(["gemini-cli"], new GeminiCliAdapter({
    subprocess: ctx.subprocess,
    sessions: ctx.sessions,
    workingDirectory: ctx.workingDirectory,
  }))

  const subagentDisposers = []
  try {
    for (const model of GEMINI_MODELS) {
      subagentDisposers.push(ctx.subagents.registerProvider(createGeminiSubagent({
        subprocess: ctx.subprocess,
        name: model.subagentProvider,
        model: model.id,
      })))
    }
    return () => {
      for (const dispose of subagentDisposers.reverse()) dispose()
      adapterDisposer()
    }
  } catch (error) {
    for (const dispose of subagentDisposers.reverse()) dispose()
    adapterDisposer()
    throw error
  }
}
