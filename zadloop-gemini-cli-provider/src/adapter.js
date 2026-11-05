import { LlmAdapter } from "@deepseek-ai/dsh-llm"
import { GEMINI_MODELS, runGeminiTask } from "./gemini.js"
import { renderGeminiPrompt } from "./prompt.js"

export class GeminiCliAdapter extends LlmAdapter {
  constructor({ subprocess, sessions, workingDirectory }) {
    super()
    this.subprocess = subprocess
    this.sessions = sessions
    this.workingDirectory = workingDirectory
  }

  providerInfo(provider) {
    return { id: provider, name: "Gemini CLI" }
  }

  listModels(provider) {
    return Promise.resolve(GEMINI_MODELS.map(({ id, name }) => ({ provider, id, name, inputModalities: ["text"] })))
  }

  resolveModel(provider, model) {
    const supportedModel = GEMINI_MODELS.find((candidate) => candidate.id === model)
    if (!supportedModel) throw new Error(`Unknown Gemini CLI model: ${model}`)
    return Promise.resolve({ provider, id: model, name: supportedModel.name, inputModalities: ["text"] })
  }

  async *stream(options) {
    const session = options.sessionId ? this.sessions.get(options.sessionId) : undefined
    if (options.sessionId && !session) throw new Error(`Gemini CLI provider could not find Session ${options.sessionId}.`)
    const cwd = session
      ? this.workingDirectory.get(session)
      : this.workingDirectory.defaultDirectory
    const response = await runGeminiTask({
      subprocess: this.subprocess,
      task: renderGeminiPrompt(options.messages, options.system),
      cwd,
      model: options.model,
      signal: options.signal,
    })
    if (response) yield { type: "text-delta", index: 0, text: response }
    yield { type: "finish", reason: { kind: "stop" } }
  }
}
