import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { PassThrough, Readable } from "node:stream"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { GeminiCliAdapter } from "../src/adapter.js"
import { streamGeminiImageTask, streamGeminiTask } from "../src/gemini.js"
import { readJsonLines } from "../src/json-lines.js"

const fakeGemini = fileURLToPath(new URL("./fake-gemini.js", import.meta.url))
const model = "gemini-3.1-pro-preview"
const attachment = { id: "fixture-image", width: 640, height: 480, bytes: 4096 }
const bytes = new Uint8Array([0, 1, 127, 255])

function fixture(t, scenario = "success", holdExit = false, spawnHandle, platform = "posix") {
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
    async terminalEnvironment() { return { platform } },
    async resolveExecutable() { return "/fake/gemini" },
    spawn(spec) {
      launch = spec
      if (spawnHandle) return spawnHandle(spec)
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
          if (holdExit === "reject") {
            throw new Error('fixture cleanup failure password: "synthetic secret phrase" at https://example.test/?key=url-query-secret')
          }
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

function textOptions(signal) {
  return {
    provider: "gemini", model, sessionId: "session", signal,
    messages: [{ role: "user", content: [{ type: "text", text: "Say hello" }] }],
  }
}

async function collect(stream) {
  const events = []
  for await (const event of stream) events.push(event)
  return events
}

async function collectIterator(iterator) {
  const events = []
  while (true) {
    const next = await iterator.next()
    if (next.done) return events
    events.push(next.value)
  }
}

test("image request reaches Gemini over ACP and streams response chunks", { timeout: 5000 }, async (t) => {
  const f = fixture(t)
  const signal = new AbortController().signal
  const events = await collect(f.adapter.stream(options(signal)))
  const prompt = await f.promptReceived
  assert.deepEqual(events, [
    { type: "text-delta", index: 0, text: "Fixture " },
    { type: "text-delta", index: 0, text: "answer" },
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

test("ACP split UTF-8 update is delivered intact", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "split")
  const events = await collect(f.adapter.stream(options(new AbortController().signal)))
  assert.deepEqual(events, [
    { type: "text-delta", index: 0, text: "Grüße 😀" },
    { type: "finish", reason: { kind: "stop" } },
  ])
})

test("default alias is selectable and sends images to Gemini 3.8 Flash", { timeout: 5000 }, async (t) => {
  const f = fixture(t)
  const models = await f.adapter.listModels("gemini-cli")
  assert.ok(models.some((entry) => entry.id === "default"))
  assert.equal((await f.adapter.resolveModel("gemini-cli", "default")).id, "default")
  await collect(f.adapter.stream({ ...options(new AbortController().signal), provider: "gemini-cli", model: "default" }))
  assert.ok(f.launch.argv.includes("gemini-3.8-flash"))
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

for (const [scenario, expected] of [["malformed", /invalid protocol|JSON/], ["error", /Gemini CLI reported an error/]]) {
  test(`${scenario} ACP response fails the stream and terminates Gemini`, { timeout: 5000 }, async (t) => {
    const f = fixture(t, scenario)
    await assert.rejects(collect(f.adapter.stream(options(new AbortController().signal))), expected)
    assert.notEqual(f.child.signalCode, null)
  })
}

test("ACP text followed by an error rejects instead of reporting success", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "partial-error")
  const iterator = f.adapter.stream(options(new AbortController().signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "Partial" })
  await assert.rejects(iterator.next(), /Gemini CLI reported an error/)
  assert.notEqual(f.child.signalCode, null)
})

test("ACP errors use a fixed classification instead of forwarding diagnostic text", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "secret-error")
  const error = await collect(f.adapter.stream(options(new AbortController().signal))).catch((reason) => reason)
  assert.ok(error instanceof Error)
  assert.equal(error.message, "Gemini CLI reported an error.")
  assert.doesNotMatch(error.message, /synthetic secret phrase|url-query-secret/)
})

test("end_turn without response text fails rather than reporting success", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "empty")
  await assert.rejects(collect(f.adapter.stream(options(new AbortController().signal))), /no response text/)
  assert.notEqual(f.child.signalCode, null)
})

test("ACP stop reasons do not forward arbitrary diagnostic text", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "unsafe-stop-reason")
  const error = await collect(f.adapter.stream(options(new AbortController().signal))).catch((reason) => reason)
  assert.ok(error instanceof Error)
  assert.equal(error.message, "Gemini CLI ACP stopped before completing the request.")
  assert.doesNotMatch(error.message, /denied|AIzaFixtureSecretValue/)
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

test("text cancellation closes stdout even when host termination leaves it open", { timeout: 5000 }, async (t) => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  let finishDone
  let terminated = false
  const done = new Promise((resolveDone) => { finishDone = resolveDone })
  const f = fixture(t, "success", false, () => ({
    stdin,
    stdout,
    stderr,
    done,
    terminate() {
      terminated = true
      finishDone({ exitCode: null, signal: "SIGTERM" })
    },
    async waitForExit() {},
  }))
  const controller = new AbortController()
  const iterator = f.adapter.stream(textOptions(controller.signal))[Symbol.asyncIterator]()
  const first = iterator.next()
  stdout.write(`${JSON.stringify({ type: "message", role: "assistant", content: "partial", delta: true })}\n`)
  assert.deepEqual(await first, {
    value: { type: "text-delta", index: 0, text: "partial" },
    done: false,
  })

  const pending = iterator.next()
  controller.abort()
  await assert.rejects(pending, /cancelled/)

  assert.equal(terminated, true)
  assert.equal(stdout.destroyed, true)
})

test("range failure is observed without waiting for process settlement", { timeout: 5000 }, async (t) => {
  const stdout = new PassThrough()
  const done = new Promise(() => {})
  const f = fixture(t, "success", false, () => ({
    stdin: new PassThrough(),
    stdout,
    stderr: new PassThrough(),
    done,
    terminate() {},
    async waitForExit() {
      throw new Error("synthetic managed-range failure")
    },
  }))
  const execution = collect(f.adapter.stream(textOptions(new AbortController().signal)))
  await new Promise((resolve) => setImmediate(resolve))
  stdout.write("not-json\n")

  const failure = await execution.catch((error) => error)
  assert.ok(failure instanceof AggregateError)
  assert.match(failure.errors[0].message, /invalid protocol output/)
  assert.equal(failure.errors[1].message, "Gemini CLI cleanup failed.")
  assert.doesNotMatch(failure.message, /synthetic managed-range failure/)
  assert.equal(stdout.destroyed, true)
})

test("stalled process and range waits time out and preserve the request error", { timeout: 10_000 }, async (t) => {
  const stdout = new PassThrough()
  let cleanupSignal
  const f = fixture(t, "success", false, () => ({
    stdin: new PassThrough(),
    stdout,
    stderr: new PassThrough(),
    done: new Promise(() => {}),
    terminate() {},
    waitForExit(signal) {
      cleanupSignal = signal
      return new Promise((resolve, reject) => {
        if (signal.aborted) reject(signal.reason)
        else signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    },
  }))
  const execution = collect(f.adapter.stream(textOptions(new AbortController().signal)))
  await new Promise((resolve) => setImmediate(resolve))
  stdout.write("not-json\n")
  const startedAt = Date.now()

  const failure = await execution.catch((error) => error)

  assert.ok(failure instanceof AggregateError)
  assert.match(failure.errors[0].message, /invalid protocol output/)
  assert.equal(failure.errors[1].message, "Gemini CLI cleanup failed.")
  assert.equal(cleanupSignal.aborted, true)
  assert.ok(Date.now() - startedAt < 8000)
  assert.equal(stdout.destroyed, true)
})

test("Windows executable lookup cleanup is bounded after cancellation", { timeout: 15_000 }, async (t) => {
  let signalLookupStarted
  let signalCleanupWaitStarted
  let cleanupSignal
  let terminationCount = 0
  const lookupStarted = new Promise((resolveLookup) => { signalLookupStarted = resolveLookup })
  const cleanupWaitStarted = new Promise((resolveWait) => { signalCleanupWaitStarted = resolveWait })
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  const f = fixture(t, "success", false, (spec) => {
    signalLookupStarted(spec)
    return {
      stdin,
      stdout,
      stderr,
      done: new Promise(() => {}),
      terminate() { terminationCount += 1 },
      waitForExit(signal) {
        cleanupSignal = signal
        signalCleanupWaitStarted()
        return new Promise(() => {})
      },
    }
  }, "windows")
  const controller = new AbortController()
  const response = collect(f.adapter.stream(textOptions(controller.signal)))
  const lookupSpec = await lookupStarted
  controller.abort()
  await cleanupWaitStarted

  const failure = await response.catch((error) => error)

  assert.deepEqual(lookupSpec.argv.slice(-1), ["gemini.cmd"])
  assert.ok(failure instanceof AggregateError)
  assert.match(failure.errors[0].message, /cancelled/)
  assert.equal(failure.errors[1].message, "Gemini CLI cleanup failed.")
  assert.equal(cleanupSignal.aborted, true)
  assert.equal(terminationCount, 1)
  assert.equal(stdout.destroyed, true)
  assert.equal(f.launch, lookupSpec)
})

test("late cancellation during cleanup preserves the earlier protocol failure", { timeout: 5000 }, async (t) => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  let finishDone
  let signalCleanupWaitStarted
  let releaseCleanupWait
  const done = new Promise((resolveDone) => { finishDone = resolveDone })
  const cleanupWaitStarted = new Promise((resolveWait) => { signalCleanupWaitStarted = resolveWait })
  const f = fixture(t, "success", false, () => ({
    stdin,
    stdout,
    stderr,
    done,
    terminate() { finishDone({ exitCode: null, signal: "SIGTERM" }) },
    waitForExit() {
      signalCleanupWaitStarted()
      return new Promise((resolveWait) => { releaseCleanupWait = resolveWait })
    },
  }))
  const controller = new AbortController()
  const response = collect(f.adapter.stream(textOptions(controller.signal)))
  await new Promise((resolve) => setImmediate(resolve))
  stdout.write("not-json\n")
  await cleanupWaitStarted
  controller.abort()
  releaseCleanupWait()

  const failure = await response.catch((error) => error)

  assert.ok(failure instanceof Error)
  assert.match(failure.message, /invalid protocol output/)
  assert.doesNotMatch(failure.message, /cancelled/)
})

test("ACP termination exceptions do not replace the protocol failure", { timeout: 5000 }, async (t) => {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const stdin = new PassThrough()
  let finishDone
  let signalCleanupWaitStarted
  const done = new Promise((resolveDone) => { finishDone = resolveDone })
  const cleanupWaitStarted = new Promise((resolveWait) => { signalCleanupWaitStarted = resolveWait })
  let terminationCount = 0
  const f = fixture(t, "success", false, () => ({
    stdin,
    stdout,
    stderr,
    done,
    terminate() {
      terminationCount += 1
      throw new Error("synthetic terminate failure")
    },
    waitForExit() {
      signalCleanupWaitStarted()
      finishDone({ exitCode: null, signal: "SIGTERM" })
    },
  }))
  const response = collect(f.adapter.stream(options(new AbortController().signal)))
  await new Promise((resolve) => setImmediate(resolve))
  stdout.write("not-json\n")
  await cleanupWaitStarted

  const failure = await response.catch((error) => error)

  assert.ok(failure instanceof AggregateError)
  assert.match(failure.errors[0].message, /invalid protocol output/)
  assert.equal(failure.errors[1].message, "Gemini CLI cleanup failed.")
  assert.doesNotMatch(failure.message, /synthetic terminate failure/)
  assert.equal(terminationCount, 1)
})

test("cancellation preserves a safe cleanup-failure classification", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "success", "reject")
  const controller = new AbortController()
  const response = collect(f.adapter.stream(options(controller.signal)))
  await f.exitWaitStarted
  controller.abort()
  f.releaseExit()
  const error = await response.catch((reason) => reason)
  assert.ok(error instanceof AggregateError)
  assert.match(error.message, /cancelled/)
  assert.match(error.message, /cleanup also failed/)
  assert.equal(error.errors[1].message, "Gemini CLI cleanup failed.")
  assert.doesNotMatch(error.message, /synthetic secret phrase|url-query-secret/)
})

test("successful text stream fails when cleanup fails without exposing diagnostics", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-success", "reject")
  const iterator = f.adapter.stream(textOptions(new AbortController().signal))[Symbol.asyncIterator]()
  assert.deepEqual(await iterator.next(), { value: { type: "text-delta", index: 0, text: "Fixture 😀" }, done: false })
  f.child.send("finish")
  assert.deepEqual(await iterator.next(), { value: { type: "text-delta", index: 0, text: " answer" }, done: false })
  const terminal = iterator.next()
  await f.exitWaitStarted
  f.releaseExit()
  const error = await terminal.catch((reason) => reason)
  assert.ok(error instanceof Error)
  assert.equal(error.message, "Gemini CLI cleanup failed.")
  assert.doesNotMatch(error.message, /synthetic secret phrase|url-query-secret/)
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

test("closing an ACP consumer early terminates the process", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "slow")
  const iterator = f.adapter.stream(options(new AbortController().signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "First" })
  await iterator.return()
  assert.notEqual(f.child.signalCode, null)
})

test("text requests use stream-json and yield deltas before completion", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-success")
  const iterator = f.adapter.stream(textOptions(new AbortController().signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "Fixture 😀" })
  assert.ok(f.launch.argv.includes("stream-json"))
  assert.ok(!f.launch.argv.includes("--acp"))
  assert.equal(f.launch.stdio.stdout, "pipe")
  assert.match(f.launch.stdio.stdin.data, /Say hello/)
  assert.equal(f.child.exitCode, null)
  f.child.send("finish")
  assert.deepEqual(await collectIterator(iterator), [
    { type: "text-delta", index: 0, text: " answer" },
    { type: "finish", reason: { kind: "stop" } },
  ])
  assert.equal(f.child.exitCode, 0)
})

test("unrelated severity-error events do not fail a successful result", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-warning")
  const events = await collect(f.adapter.stream(textOptions(new AbortController().signal)))
  assert.deepEqual(events, [
    { type: "text-delta", index: 0, text: "Warning survived" },
    { type: "finish", reason: { kind: "stop" } },
  ])
})

test("the installed max-turn error fails even when result status is success", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-max-turn")
  const iterator = f.adapter.stream(textOptions(new AbortController().signal))[Symbol.asyncIterator]()
  assert.deepEqual(await iterator.next(), {
    value: { type: "text-delta", index: 0, text: "Partial response" },
    done: false,
  })
  await assert.rejects(iterator.next(), /session turn limit/)
})

test("stream-json text followed by a terminal error uses a safe classification", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-error-after-text")
  const iterator = f.adapter.stream(textOptions(new AbortController().signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "Partial" })
  const error = await iterator.next().catch((reason) => reason)
  assert.ok(error instanceof Error)
  assert.match(error.message, /authentication failed/)
  assert.doesNotMatch(error.message, /AIzaFixtureSecretValue/)
})

test("stream-json result errors do not forward diagnostic credentials", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-secret")
  const error = await collect(f.adapter.stream(textOptions(new AbortController().signal))).catch((reason) => reason)
  assert.ok(error instanceof Error)
  assert.equal(error.message, "Gemini CLI reported an error.")
  assert.doesNotMatch(error.message, /url-query-secret|second-query-secret|synthetic secret phrase|fixture-bearer-secret/)
})

test("stream-json success without text is not reported as success", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-empty")
  await assert.rejects(collect(f.adapter.stream(textOptions(new AbortController().signal))), /no response text/)
})

for (const [scenario, expected] of [
  ["stream-malformed", /invalid protocol|JSON/],
  ["stream-incomplete", /invalid protocol output/],
  ["stream-no-result", /invalid protocol output/],
  ["stream-nonzero", /exited with code 3/],
  ["stream-auth-stderr", /authentication failed/],
  ["stream-quota", /quota or rate limit/],
]) {
  test(`${scenario} fails with an actionable classification`, { timeout: 5000 }, async (t) => {
    const f = fixture(t, scenario)
    await assert.rejects(collect(f.adapter.stream(textOptions(new AbortController().signal))), expected)
    assert.ok(f.child.exitCode !== null || f.child.signalCode !== null)
  })
}

test("cancelling a text stream terminates the process", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-slow")
  const controller = new AbortController()
  const iterator = f.adapter.stream(textOptions(controller.signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "First" })
  controller.abort()
  await assert.rejects(iterator.next(), /cancelled/)
  assert.notEqual(f.child.signalCode, null)
})

test("closing a text consumer early terminates the process", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-slow")
  const iterator = f.adapter.stream(textOptions(new AbortController().signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "First" })
  await iterator.return()
  assert.notEqual(f.child.signalCode, null)
})

test("closing the host stream propagates a process cleanup failure", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-slow", "reject")
  const iterator = f.adapter.stream(textOptions(new AbortController().signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "First" })

  const closing = iterator.return()
  await f.exitWaitStarted
  f.releaseExit()
  const error = await closing.catch((reason) => reason)

  assert.equal(error.message, "Gemini CLI cleanup failed.")
  assert.doesNotMatch(error.message, /synthetic secret phrase|url-query-secret/)
})

test("readJsonLines decodes split UTF-8 and skips empty lines", async () => {
  const line = Buffer.from(`\n${JSON.stringify({ text: "Grüße 😀" })}\r\n\n`)
  const emoji = Buffer.from("😀")
  const split = line.indexOf(emoji) + 2
  const events = []
  for await (const value of readJsonLines(Readable.from([line.subarray(0, split), line.subarray(split)]), { maxBytes: 1024 })) {
    events.push(value)
  }
  assert.deepEqual(events, [{ text: "Grüße 😀" }])
})

for (const [name, chunks, expected] of [
  ["cumulative byte limit", [Buffer.from('{"a":1}\n'), Buffer.from('{"b":2}\n')], /output limit/],
  ["invalid JSON", [Buffer.from("not-json\n")], /invalid protocol output/],
  ["unterminated message", [Buffer.from('{"a":1}')], /invalid protocol output/],
]) {
  test(`readJsonLines rejects ${name}`, async () => {
    await assert.rejects(async () => {
      for await (const _value of readJsonLines(Readable.from(chunks), { maxBytes: 12 })) { /* consume */ }
    }, expected)
  })
}

test("declared peer range keeps supported host versions and accepts rc.2", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"))
  const declared = pkg.peerDependencies["@deepseek-ai/dsh-llm"].split("||").map((entry) => entry.trim())
  for (const version of ["0.2.1-rc.2", "0.2.2-rc.1", "0.2.2-rc.2"]) assert.ok(declared.includes(version), version)
})

test("WebSocket disconnect abort is distinguished from user cancellation and preserves partial output", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-slow")
  const controller = new AbortController()
  const iterator = f.adapter.stream(textOptions(controller.signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "First" })
  const disconnect = new Error("api gateway: Remote stream WebSocket closed")
  disconnect.name = "RemoteStreamCarrierError"
  controller.abort(disconnect)
  await assert.rejects(iterator.next(), /ZadLoop connection closed/)
  assert.notEqual(f.child.signalCode, null)
})

test("host timeout abort is distinguished from user cancellation", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-slow")
  const controller = new AbortController()
  const iterator = f.adapter.stream(textOptions(controller.signal))[Symbol.asyncIterator]()
  await iterator.next()
  const hostTimeout = new Error("Request timed out")
  hostTimeout.name = "TimeoutError"
  controller.abort(hostTimeout)
  await assert.rejects(iterator.next(), /timed out in ZadLoop/)
  assert.notEqual(f.child.signalCode, null)
})

test("provider bounded timeout reports timeout (not cancellation) on text and ACP paths and cleans up", { timeout: 5000 }, async (t) => {
  const textF = fixture(t, "stream-slow")
  const textIter = streamGeminiTask({
    subprocess: textF.adapter.subprocess,
    task: "hello",
    cwd: resolve("fixture-project"),
    model,
    timeoutMs: 600,
  })[Symbol.asyncIterator]()
  const firstText = await textIter.next()
  assert.equal(firstText.value, "First")
  await assert.rejects(textIter.next(), /did not finish within 600 ms/)
  assert.notEqual(textF.child.signalCode, null)

  const acpF = fixture(t, "slow")
  const acpIter = streamGeminiImageTask({
    subprocess: acpF.adapter.subprocess,
    task: "describe",
    images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
    cwd: resolve("fixture-project"),
    model,
    timeoutMs: 600,
  })[Symbol.asyncIterator]()
  const firstAcp = await acpIter.next()
  assert.equal(firstAcp.value, "First")
  await assert.rejects(acpIter.next(), /did not finish within 600 ms/)
  assert.notEqual(acpF.child.signalCode, null)
})

test("CLI upstream context cancellation is not misreported as user cancellation", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-upstream-cancel")
  const iterator = f.adapter.stream(textOptions(new AbortController().signal))[Symbol.asyncIterator]()
  const first = await iterator.next()
  assert.deepEqual(first.value, { type: "text-delta", index: 0, text: "Partial" })
  const error = await iterator.next().catch((reason) => reason)
  assert.match(error.message, /upstream request was interrupted or cancelled/i)
  assert.doesNotMatch(error.message, /^Gemini task was cancelled\.$/)
})

test("wrapped cause WebSocket disconnect is classified and invalid timeoutMs is rejected", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-slow")
  const controller = new AbortController()
  const iterator = f.adapter.stream(textOptions(controller.signal))[Symbol.asyncIterator]()
  await iterator.next()
  const rootCause = new Error("api gateway: Remote stream WebSocket closed")
  rootCause.name = "RemoteStreamCarrierError"
  controller.abort(new Error("carrier aborted", { cause: rootCause }))
  await assert.rejects(iterator.next(), /ZadLoop connection closed/)

  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -10]) {
    await assert.rejects(
      collect(streamGeminiTask({ subprocess: f.adapter.subprocess, task: "hi", cwd: resolve("fixture-project"), model, timeoutMs: bad })),
      RangeError,
    )
    await assert.rejects(
      collect(streamGeminiTask({ subprocess: f.adapter.subprocess, task: "hi", cwd: resolve("fixture-project"), model, idleTimeoutMs: bad })),
      RangeError,
    )
  }
})

test("active tool_use/tool_result progress survives beyond idleTimeoutMs on text and ACP paths", { timeout: 5000 }, async (t) => {
  const textF = fixture(t, "stream-active-progress")
  const textChunks = await collect(streamGeminiTask({
    subprocess: textF.adapter.subprocess,
    task: "investigate",
    cwd: resolve("fixture-project"),
    model,
    idleTimeoutMs: 260,
    maxTimeoutMs: 2500,
  }))
  assert.deepEqual(textChunks, ["Active run done"])

  const acpF = fixture(t, "acp-active-progress")
  const acpChunks = await collect(streamGeminiImageTask({
    subprocess: acpF.adapter.subprocess,
    task: "describe",
    images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
    cwd: resolve("fixture-project"),
    model,
    idleTimeoutMs: 260,
    maxTimeoutMs: 2500,
  }))
  assert.deepEqual(acpChunks, ["ACP active done"])
})

test("stderr noise and fake heartbeat events do not reset idleTimeoutMs on text or ACP paths", { timeout: 5000 }, async (t) => {
  const textF = fixture(t, "stream-noise-stall")
  const textIter = streamGeminiTask({
    subprocess: textF.adapter.subprocess,
    task: "investigate",
    cwd: resolve("fixture-project"),
    model,
    idleTimeoutMs: 260,
    maxTimeoutMs: 3000,
  })[Symbol.asyncIterator]()
  const firstText = await textIter.next()
  assert.equal(firstText.value, "First")
  await assert.rejects(textIter.next(), /stalled with no progress for 260 ms/)
  assert.notEqual(textF.child.signalCode, null)

  const acpF = fixture(t, "acp-noise-stall")
  const acpIter = streamGeminiImageTask({
    subprocess: acpF.adapter.subprocess,
    task: "describe",
    images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
    cwd: resolve("fixture-project"),
    model,
    idleTimeoutMs: 260,
    maxTimeoutMs: 3000,
  })[Symbol.asyncIterator]()
  const firstAcp = await acpIter.next()
  assert.equal(firstAcp.value, "First")
  await assert.rejects(acpIter.next(), /stalled with no progress for 260 ms/)
  assert.notEqual(acpF.child.signalCode, null)
})

test("absolute maxTimeoutMs still bounds continuously active streams and cleans up", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-active-forever")
  const iter = streamGeminiTask({
    subprocess: f.adapter.subprocess,
    task: "loop",
    cwd: resolve("fixture-project"),
    model,
    idleTimeoutMs: 300,
    maxTimeoutMs: 550,
  })[Symbol.asyncIterator]()
  const first = await iter.next()
  assert.equal(first.value, "Start")
  await assert.rejects(iter.next(), /did not finish within 550 ms/)
  assert.notEqual(f.child.signalCode, null)
})

test("user cancellation remains immediate during an active long-running stream", { timeout: 5000 }, async (t) => {
  const f = fixture(t, "stream-active-forever")
  const controller = new AbortController()
  const iter = streamGeminiTask({
    subprocess: f.adapter.subprocess,
    task: "loop",
    cwd: resolve("fixture-project"),
    model,
    signal: controller.signal,
    idleTimeoutMs: 2000,
    maxTimeoutMs: 4000,
  })[Symbol.asyncIterator]()
  const first = await iter.next()
  assert.equal(first.value, "Start")
  controller.abort()
  await assert.rejects(iter.next(), { message: "Gemini task was cancelled." })
  assert.notEqual(f.child.signalCode, null)
})
