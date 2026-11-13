import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { GeminiCliAdapter } from "../src/adapter.js"

const fakeGemini = fileURLToPath(new URL("./fake-gemini.js", import.meta.url))
const model = "gemini-3.1-pro-preview"
const attachment = { id: "fixture-image", width: 640, height: 480, bytes: 4096 }
const bytes = new Uint8Array([0, 1, 127, 255])

function fixture(t, scenario = "success", holdExit = false) {
  let releaseExit
  let signalExitWait
  const exitWaitStarted = new Promise((resolveWait) => { signalExitWait = resolveWait })
  const exitReleased = new Promise((resolveRelease) => { releaseExit = resolveRelease })
  let child
  let launch
  let signalPrompt
  let signalPermission
  const promptReceived = new Promise((resolvePrompt) => { signalPrompt = resolvePrompt })
  const permissionReceived = new Promise((resolvePermission) => { signalPermission = resolvePermission })
  const requests = []
  const subprocess = {
    async terminalEnvironment() { return { platform: "posix" } },
    async resolveExecutable() { return "/fake/gemini" },
    spawn(spec) {
      launch = spec
      child = spawn(process.execPath, [fakeGemini, scenario], { stdio: ["pipe", "pipe", "pipe", "ipc"] })
      child.on("message", (message) => {
        requests.push(message)
        if (message.method === "session/prompt") signalPrompt(message)
        if (message.id === 900) signalPermission(message)
      })
      const done = new Promise((resolveDone, reject) => {
        child.once("error", reject)
        child.once("exit", (exitCode, signal) => resolveDone({ exitCode, signal }))
      })
      return {
        stdin: child.stdin, stdout: child.stdout, stderr: child.stderr, done,
        terminate() { child.kill() },
        async waitForExit() {
          await done
          if (holdExit) { signalExitWait(); await exitReleased }
          if (holdExit === "reject") throw new Error("fixture cleanup failure")
        },
      }
    },
  }
  t.after(() => { releaseExit(); if (child && child.exitCode === null && child.signalCode === null) child.kill() })
  const reads = []
  const adapter = new GeminiCliAdapter({
    subprocess,
    sessions: { get: () => ({ id: "session" }) },
    workingDirectory: { get: () => resolve("fixture-project"), defaultDirectory: resolve("default-project") },
    attachments: { async readImageRequest(ref, target, signal) { reads.push({ ref, target, signal }); return { data: bytes, mediaType: "image/png" } } },
  })
  return { adapter, reads, requests, promptReceived, permissionReceived, exitWaitStarted, releaseExit, get launch() { return launch }, get child() { return child } }
}

function options(signal) {
  return {
    provider: "gemini", model, sessionId: "session", signal,
    messages: [{ role: "user", content: [{ type: "text", text: "Describe this" }, { type: "image", attachment }] }],
  }
}

async function collect(stream) {
  const events = []
  for await (const event of stream) events.push(event)
  return events
}

test("image request reaches Gemini over ACP and returns streamed response", { timeout: 5000 }, async (t) => {
  const f = fixture(t)
  const signal = new AbortController().signal
  const events = await collect(f.adapter.stream(options(signal)))
  const prompt = await f.promptReceived
  assert.deepEqual(events, [
    { type: "text-delta", index: 0, text: "Fixture answer" },
    { type: "finish", reason: { kind: "stop" } },
  ])
  assert.equal(f.reads[0].ref, attachment)
  assert.deepEqual(f.reads[0].target, { width: 640, height: 480, maxBytes: 4096 })
  assert.equal(f.reads[0].signal, signal)
  assert.ok(f.launch.argv.includes(model))
  assert.ok(f.launch.argv.includes("--acp"))
  assert.equal(f.launch.cwd, resolve("fixture-project"))
  assert.deepEqual(f.requests.map((request) => request.method), ["initialize", "session/new", "session/prompt"])
  assert.equal(prompt.params.sessionId, "fixture-session")
  assert.match(prompt.params.prompt[0].text, /Describe this/)
  assert.deepEqual(prompt.params.prompt[1], { type: "image", mimeType: "image/png", data: Buffer.from(bytes).toString("base64") })
  assert.notEqual(f.child.signalCode, null)
})

for (const [name, version] of [
  ["empty data", { data: new Uint8Array(), mediaType: "image/png" }],
  ["unsupported MIME type", { data: bytes, mediaType: "image/svg+xml" }],
]) {
  test(`${name} is rejected before starting Gemini`, { timeout: 5000 }, async (t) => {
    const f = fixture(t)
    f.adapter.attachments = { async readImageRequest() { return version } }
    await assert.rejects(collect(f.adapter.stream(options(new AbortController().signal))), /requires a non-empty PNG/)
    assert.equal(f.launch, undefined)
  })
}

test("agent without image capability fails without sending an image", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "unsupported")
  await assert.rejects(collect(f.adapter.stream(options(new AbortController().signal))), /does not support image input/)
  assert.deepEqual(f.requests.map((request) => request.method), ["initialize"])
  assert.notEqual(f.child.signalCode, null)
})

for (const [scenario, expected] of [["malformed", /JSON/], ["error", /fixture ACP failure/]]) {
  test(`${scenario} ACP response fails the stream and terminates Gemini`, { timeout: 5000 }, async (t) => {
    const f = fixture(t, scenario)
    await assert.rejects(collect(f.adapter.stream(options(new AbortController().signal))), expected)
    assert.notEqual(f.child.signalCode, null)
  })
}

test("end_turn without response text fails rather than reporting success", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "empty")
  await assert.rejects(collect(f.adapter.stream(options(new AbortController().signal))), /no response text/)
  assert.notEqual(f.child.signalCode, null)
})

test("server permission request is denied without approving an option", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "permission")
  const events = await collect(f.adapter.stream(options(new AbortController().signal)))
  const response = await f.permissionReceived
  assert.deepEqual(response, { jsonrpc: "2.0", id: 900, error: { code: -32601, message: "Client method unavailable" } })
  assert.deepEqual(events, [
    { type: "text-delta", index: 0, text: "Permission denied" },
    { type: "finish", reason: { kind: "stop" } },
  ])
})

test("cancellation during process cleanup rejects instead of yielding success", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "success", true)
  const controller = new AbortController()
  const response = collect(f.adapter.stream(options(controller.signal)))
  await f.exitWaitStarted
  controller.abort()
  f.releaseExit()
  await assert.rejects(response, /cancelled/)
})

test("cancellation preserves cleanup failure details", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "success", "reject")
  const controller = new AbortController()
  const response = collect(f.adapter.stream(options(controller.signal)))
  await f.exitWaitStarted
  controller.abort()
  f.releaseExit()
  await assert.rejects(response, /cancelled.*fixture cleanup failure/)
})

test("cancellation while awaiting an ACP response terminates the process", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "wait")
  const controller = new AbortController()
  const response = collect(f.adapter.stream(options(controller.signal)))
  await f.promptReceived
  controller.abort()
  await assert.rejects(response, /cancelled/)
  assert.notEqual(f.child.signalCode, null)
})
