"use strict"

const { Plugin, Theme } = require("@opencode/plugin/gui")

// Desktop selects the light or dark palette according to its appearance setting.
const light = {
  neutral: "#f7f8fa", ink: "#202632", primary: "#365d9e",
  success: "#23734c", warning: "#925b0a", error: "#ad3847", info: "#345f9c",
}

const themes = [
  {
    id: "midnight-purple", name: "Midnight Purple",
    light: { palette: { ...light, primary: "#6942a1", info: "#6545a0" } },
    dark: { palette: {
      neutral: "#191423", ink: "#eee7f8", primary: "#c4a0f3",
      success: "#83c99c", warning: "#e5b86e", error: "#f08091", info: "#a7b8f5",
    } },
  },
  {
    id: "ocean-blue", name: "Ocean Blue",
    light: { palette: { ...light, primary: "#126b91", info: "#2968a4" } },
    dark: { palette: {
      neutral: "#101d2b", ink: "#e1eef7", primary: "#73c9eb",
      success: "#82cda7", warning: "#e5bd79", error: "#ef8c91", info: "#91baf4",
    } },
  },
  {
    id: "emerald-night", name: "Emerald Night",
    light: { palette: { ...light, primary: "#216d50", info: "#376c83" } },
    dark: { palette: {
      neutral: "#151e1b", ink: "#e2efe8", primary: "#83d3a6",
      success: "#83d3a6", warning: "#e5bd79", error: "#ee9092", info: "#8dbfe0",
    } },
  },
  {
    id: "warm-sunset", name: "Warm Sunset",
    light: { palette: { ...light, neutral: "#fbf7f2", primary: "#9b4b20", info: "#6757a0" } },
    dark: { palette: {
      neutral: "#241a19", ink: "#f5e9e1", primary: "#f1b17a",
      success: "#a5cb8e", warning: "#edc17d", error: "#f38e87", info: "#bea9e8",
    } },
  },
  {
    id: "clean-light", name: "Clean Light",
    light: { palette: light },
    dark: { palette: {
      neutral: "#1b1f27", ink: "#e7ebf1", primary: "#a0bdeb",
      success: "#91caa5", warning: "#e3bc7b", error: "#ed929a", info: "#9bbde9",
    } },
  },
]

exports.default = Plugin.define({
  setup(ctx) {
    for (const theme of themes) ctx.add(Theme, theme)
  },
})
