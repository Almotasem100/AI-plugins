import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

async function readPluginFile(fileName) {
  return readFile(new URL(`../${fileName}`, import.meta.url), "utf8")
}

const [manifestText, patch, client, localeText] = await Promise.all([
  readPluginFile("package.json"),
  readPluginFile("cordis.patch.yml"),
  readPluginFile("client.js"),
  readPluginFile("locale/en.json"),
])
const manifest = JSON.parse(manifestText)
const locale = JSON.parse(localeText)

assert.equal(manifest.name, "@local/donald-duck")
assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml")
assert.equal(manifest.dsh.client.platform, "web")
assert.equal(manifest.exports["./client"], "./client.js")
assert.ok(manifest.files.includes("client.js"))
assert.ok(manifest.files.includes("assets/donald-duck.png"))
assert.ok(manifest.files.includes("icon.svg"))
assert.equal(locale.meta.title, "Donald Duck")
assert.ok(patch.includes(`name: '${manifest.name}'`))
assert.ok(client.includes(`id: '${manifest.name}'`))

console.log("Donald Duck bundle metadata smoke test passed.")
