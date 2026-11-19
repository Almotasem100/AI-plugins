import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("independently packaged Gemini doctors use the same source and tests", async () => {
  for (const file of ["src/doctor.js", "test/doctor.test.js"]) {
    const [opencode, zadloop] = await Promise.all(
      ["opencode", "zadloop"].map((host) =>
        readFile(new URL(`../${host}-gemini-cli-provider/${file}`, import.meta.url), "utf8"),
      ),
    )
    assert.ok(opencode.replaceAll("\r\n", "\n") === zadloop.replaceAll("\r\n", "\n"), `${file} differs between packages`)
  }
})
