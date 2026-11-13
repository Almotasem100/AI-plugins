import { Model, Plugin, Provider } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { createGeminiLanguageModel } from "./provider.js"

const PROVIDER_ID = Provider.ID.make("gemini-cli")
const SDK_PACKAGE = "@ai-sdk/google"
const PROVIDER_PACKAGE = `aisdk:${SDK_PACKAGE}`

function modelDefinition(id, name, modelID = id) {
  return {
    ...Model.Info.default(PROVIDER_ID, Model.ID.make(id)),
    name,
    modelID,
    capabilities: {
      tools: false,
      input: ["text", "image"],
      output: ["text"],
    },
  }
}

function providerDefinition() {
  return {
    info: {
      ...Provider.Info.empty(PROVIDER_ID),
      name: "Gemini",
      activation: "enabled",
      package: PROVIDER_PACKAGE,
    },
    models: [
      modelDefinition("gemini-3.8-flash", "Gemini 3.8 Flash"),
      modelDefinition("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview"),
    ],
  }
}

export default Plugin.define({
  id: "opencode-gemini-cli-provider",
  effect: Effect.fn(function* (ctx) {
    const directory = ctx.location.directory

    yield* ctx.provider.transform((editor) => {
      editor.add(providerDefinition())
    })

    yield* ctx.aisdk.hook("sdk", (event) =>
      Effect.sync(() => {
        if (event.package !== SDK_PACKAGE || event.model.providerID !== PROVIDER_ID) return
        event.sdk = {
          languageModel: (modelID) => createGeminiLanguageModel({ modelID, cwd: directory }),
        }
      }),
    )

    yield* ctx.aisdk.hook("language", (event) =>
      Effect.sync(() => {
        if (event.model.providerID !== PROVIDER_ID) return
        event.language = event.sdk.languageModel(event.model.modelID ?? event.model.id)
      }),
    )
  }),
})
