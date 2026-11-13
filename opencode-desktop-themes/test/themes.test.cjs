const { test } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const path = require("node:path")

test("GUI entry registers five distinct, readable palette definitions", () => {
  const entry = path.join(__dirname, "..", "gui-experimental.cjs")
  const registry = {}
  const sandbox = {
    exports: {},
    require(name) {
      assert.equal(name, "@opencode/plugin/gui")
      return { Plugin: { define: (definition) => definition }, Theme: registry }
    },
  }
  vm.runInNewContext(fs.readFileSync(entry, "utf8"), sandbox, { filename: entry })
  const themes = []
  sandbox.exports.default.setup({ add: (token, theme) => {
    assert.equal(token, registry)
    themes.push(theme)
  } })
  assert.deepEqual(themes.map((theme) => theme.id), [
    "midnight-purple", "ocean-blue", "emerald-night", "warm-sunset", "clean-light",
  ])
  assert.equal(new Set(themes.map((theme) => theme.name)).size, 5)
  for (const theme of themes) {
    for (const mode of ["light", "dark"]) {
      const palette = theme[mode].palette
      for (const key of ["neutral", "ink", "primary", "success", "warning", "error", "info"]) {
        assert.match(palette[key], /^#[0-9a-f]{6}$/i, `${theme.id} ${mode} ${key}`)
      }
      assert.ok(contrast(palette.neutral, palette.ink) >= 7, `${theme.id} ${mode} ink`)
    }
  }
})

function contrast(a, b) {
  const luminance = (hex) => {
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
  }
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}
