import { readFile, writeFile } from "node:fs/promises"

const [source, image] = await Promise.all([
  readFile(new URL("../client.source.js", import.meta.url), "utf8"),
  readFile(new URL("../assets/donald-duck.png", import.meta.url)),
])
const placeholder = "__DUCK_PNG_BASE64__"
if (source.split(placeholder).length !== 2) {
  throw new Error("Client source must contain exactly one PNG placeholder")
}
if (!image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
  throw new Error("assets/donald-duck.png must be a PNG image")
}

// Inline the image so both the Desktop shell and Web carrier need only the
// client bundle, without a filesystem URL or an extra Host asset endpoint.
const bundle = source.replace(placeholder, image.toString("base64"))
const output = new URL("../client.js", import.meta.url)
const previous = await readFile(output, "utf8").catch(error => {
  if (error.code !== "ENOENT") throw error
  return null
})
if (bundle !== previous) await writeFile(output, bundle)
console.log("Built Donald Duck client with embedded PNG.")
