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
const icon = await readFile(new URL("../assets/donald-duck-icon.png", import.meta.url))

assert.equal(manifest.name, "@local/donald-duck")
assert.equal(manifest.dsh.bundle.patch, "./cordis.patch.yml")
assert.equal(manifest.dsh.client.platform, "web")
assert.equal(manifest.exports["./client"], "./client.js")
assert.ok(manifest.files.includes("client.js"))
assert.ok(manifest.files.includes("assets/donald-duck.png"))
assert.equal(manifest.exports["./icon"], "./assets/donald-duck-icon.png")
assert.ok(manifest.files.includes("assets/donald-duck-icon.png"))
assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
assert.equal(icon.readUInt32BE(16), 256)
assert.equal(icon.readUInt32BE(20), 256)
assert.ok(icon.length < 256 * 1024, "exported icon must fit the bundle icon size limit")
assert.equal(locale.meta.title, "Donald Duck")
assert.ok(patch.includes(`name: '${manifest.name}'`))
assert.ok(client.includes(`id: '${manifest.name}'`))

console.log("Donald Duck bundle metadata smoke test passed.")
