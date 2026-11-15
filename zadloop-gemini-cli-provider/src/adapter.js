import { LlmAdapter } from "@deepseek-ai/dsh-llm"
import { GEMINI_MODELS, streamGeminiImageTask, streamGeminiTask } from "./gemini.js"
import { renderGeminiPrompt } from "./prompt.js"

export class GeminiCliAdapter extends LlmAdapter {
  constructor({ subprocess, sessions, workingDirectory, attachments }) {
    super()
    this.subprocess = subprocess
    this.sessions = sessions
    this.workingDirectory = workingDirectory
    this.attachments = attachments
  }

  providerInfo(provider) {
    return { id: provider, name: "Gemini CLI" }
  }

  listModels(provider) {
    const models = [{ id: "default", name: `${GEMINI_MODELS[0].name} (Default)` }, ...GEMINI_MODELS]
    return Promise.resolve(models.map(({ id, name }) => ({ provider, id, name, inputModalities: ["text", "image"] })))
  }

  resolveModel(provider, model) {
    const supportedModel = model === "default" ? GEMINI_MODELS[0] : GEMINI_MODELS.find((candidate) => candidate.id === model)
    if (!supportedModel) throw new Error(`Unknown Gemini CLI model: ${model}`)
    return Promise.resolve({ provider, id: model, name: supportedModel.name, inputModalities: ["text", "image"] })
  }

  async *stream(options) {
    const session = options.sessionId ? this.sessions.get(options.sessionId) : undefined
    if (options.sessionId && !session) throw new Error(`Gemini CLI provider could not find Session ${options.sessionId}.`)
    const cwd = session
      ? this.workingDirectory.get(session)
      : this.workingDirectory.defaultDirectory
    const refs = []
    const task = renderGeminiPrompt(options.messages, options.system, (block) => {
      if (block.offloaded) throw new Error("Gemini CLI provider cannot send an offloaded image.")
      refs.push(block.attachment)
      return `[Attached image ${refs.length}]`
    })
    const images = await Promise.all(refs.map(async (ref) => {
      const version = await this.attachments.readImageRequest(ref, this.imageRequestTarget(options.provider, options.model, ref), options.signal)
      if (!/^image\/(png|jpeg|webp|gif)$/.test(version.mediaType) || !(version.data instanceof Uint8Array) || !version.data.length) {
        throw new Error("Gemini CLI provider requires a non-empty PNG, JPEG, WebP, or GIF image.")
      }
      return { type: "image", mimeType: version.mediaType, data: Buffer.from(version.data).toString("base64") }
    }))
    const request = { subprocess: this.subprocess, task, cwd, model: options.model, signal: options.signal }
    const chunks = images.length
      ? streamGeminiImageTask({ ...request, images })
      : streamGeminiTask(request)
    for await (const text of chunks) {
      if (text) yield { type: "text-delta", index: 0, text }
    }
    yield { type: "finish", reason: { kind: "stop" } }
  }
}
