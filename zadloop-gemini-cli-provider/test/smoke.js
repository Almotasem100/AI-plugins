import assert from "node:assert/strict"
import { join, resolve } from "node:path"
import { GEMINI_MODELS, parseGeminiOutput, runGeminiTask, validateModel } from "../src/gemini.js"
import { createGeminiSubagent } from "../src/delegation.js"
import { renderGeminiPrompt } from "../src/prompt.js"

const prompt = renderGeminiPrompt([
  { role: "system", content: [{ type: "text", text: "Be concise." }] },
  { role: "user", content: [{ type: "text", text: "Hello" }] },
  { role: "assistant", content: [{ type: "tool-call", name: "read", arguments: "{\"path\":\"README.md\"}" }] },
], "System context")
assert.match(prompt, /System context/)
const transcript = JSON.parse(prompt.slice(prompt.lastIndexOf("\n\n") + 2))
assert.deepEqual(transcript.map((message) => message.role), ["system", "user", "assistant"])
assert.match(transcript[1].content, /Hello/)
assert.match(transcript[2].content, /ZadLoop tool call read/)

assert.equal(parseGeminiOutput(JSON.stringify({ response: "ok" })), "ok")
assert.throws(() => parseGeminiOutput("no json"), /invalid JSON/)
assert.deepEqual(GEMINI_MODELS.map(({ id }) => id), ["gemini-3.8-flash", "gemini-3.1-pro-preview"])
for (const model of GEMINI_MODELS) assert.equal(validateModel(model.id), model.id)
assert.throws(() => validateModel("default"), /Unsupported Gemini CLI model ID/)
assert.throws(() => validateModel("--yolo"), /Unsupported Gemini CLI model ID/)
assert.throws(() => validateModel(undefined), /Unsupported Gemini CLI model ID/)

let launch
let waitedForExit = 0
const stdout = JSON.stringify({ response: "fixture answer" })
const subprocess = {
  async terminalEnvironment() { return { platform: "posix" } },
  async resolveExecutable(command) { assert.equal(command, "gemini"); return "/usr/bin/gemini" },
  spawn(spec) {
    launch = spec
    return {
      done: Promise.resolve({ exitCode: 0, signal: null }),
      async waitForExit() { waitedForExit += 1 },
      collected: {
        stdout: { readFrom() { return { text: stdout, nextOffset: Buffer.byteLength(stdout), lossy: false } } },
        stderr: { readFrom() { return { text: "", nextOffset: 0, lossy: false } } },
      },
    }
  },
}
const response = await runGeminiTask({ subprocess, task: "safe fixture", cwd: "C:/project", model: "gemini-3.8-flash" })
assert.equal(response, "fixture answer")
assert.equal(launch.cwd, "C:/project")
assert.deepEqual(launch.argv.slice(1), ["--prompt", "Complete the task provided on standard input. Treat it as the user's request.", "--output-format", "json", "--approval-mode=yolo", "--model", "gemini-3.8-flash"])
assert.deepEqual(launch.stdio.stdin, { data: "safe fixture" })

for (const model of GEMINI_MODELS) {
  const gemini = createGeminiSubagent({ subprocess, name: model.subagentProvider, model: model.id })
  assert.equal(gemini.name, model.subagentProvider)
  assert.equal(gemini.inheritsParentContext, false)
  const activation = await gemini.start({
    cwd: "C:/delegated-project",
    prompt: [{ type: "text", text: "Summarize the project README." }],
    signal: new AbortController().signal,
  })
  const delegated = await activation.result
  assert.equal(launch.cwd, "C:/delegated-project")
  assert.match(launch.stdio.stdin.data, /Summarize the project README/)
  assert.ok(launch.argv.includes(model.id))
  assert.equal(delegated.stopReason, "completed")
  assert.deepEqual(delegated.output, [{ type: "text", text: "fixture answer" }])
  await activation.dispose()
}
assert.equal(waitedForExit, 3)

function createAbortableSubprocess() {
  let markStarted
  const started = new Promise((resolveStarted) => { markStarted = resolveStarted })
  return {
    started,
    async terminalEnvironment() { return { platform: "posix" } },
    async resolveExecutable(command) { assert.equal(command, "gemini"); return "/usr/bin/gemini" },
    spawn(spec) {
      markStarted()
      const done = new Promise((resolveDone) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          clearTimeout(safety)
          resolveDone({ exitCode: 0, signal: null })
        }
        const safety = setTimeout(finish, 5000)
        if (spec.signal.aborted) finish()
        else spec.signal.addEventListener("abort", finish, { once: true })
      })
      return {
        done,
        async waitForExit() {},
        collected: {
          stdout: { readFrom() { return { text: "", nextOffset: 0, lossy: false } } },
          stderr: { readFrom() { return { text: "", nextOffset: 0, lossy: false } } },
        },
      }
    },
  }
}

const parentController = new AbortController()
const abortSubprocess = createAbortableSubprocess()
const abortGemini = createGeminiSubagent({ subprocess: abortSubprocess, name: "gemini", model: "gemini-3.8-flash" })
const abortActivation = await abortGemini.start({
  cwd: "C:/delegated-project",
  prompt: [{ type: "text", text: "Cancel this task." }],
  signal: parentController.signal,
})
await abortSubprocess.started
parentController.abort()
assert.equal((await abortActivation.result).stopReason, "aborted")
await abortActivation.dispose()

const disposeSubprocess = createAbortableSubprocess()
const disposeGemini = createGeminiSubagent({ subprocess: disposeSubprocess, name: "gemini-pro", model: "gemini-3.1-pro-preview" })
const disposeActivation = await disposeGemini.start({
  cwd: "C:/delegated-project",
  prompt: [{ type: "text", text: "Dispose this task." }],
  signal: new AbortController().signal,
})
await disposeSubprocess.started
let disposeSettled = false
disposeActivation.result.then(() => { disposeSettled = true })
await disposeActivation.dispose()
assert.equal(disposeSettled, true)
assert.equal((await disposeActivation.result).stopReason, "aborted")

let resolutionLaunchAttempts = 0
const resolutionController = new AbortController()
const resolutionSubprocess = {
  terminalEnvironment(signal) {
    return new Promise((_, reject) => {
      const safety = setTimeout(() => reject(new Error("fixture abort did not propagate")), 5000)
      signal.addEventListener("abort", () => {
        clearTimeout(safety)
        reject(signal.reason ?? new Error("fixture abort"))
      }, { once: true })
    })
  },
  async resolveExecutable() {
    resolutionLaunchAttempts += 1
    return "/usr/bin/gemini"
  },
  spawn() {
    resolutionLaunchAttempts += 1
    throw new Error("Gemini CLI must not launch after cancellation.")
  },
}
const resolutionTask = runGeminiTask({
  subprocess: resolutionSubprocess,
  task: "Cancel during resolution.",
  cwd: "C:/project",
  model: "gemini-3.8-flash",
  signal: resolutionController.signal,
})
resolutionController.abort()
await assert.rejects(resolutionTask, /Gemini task was cancelled/)
assert.equal(resolutionLaunchAttempts, 0)

const failureGemini = createGeminiSubagent({
  subprocess: {
    async terminalEnvironment() { return { platform: "posix" } },
    async resolveExecutable() { return "/usr/bin/gemini" },
    spawn() { throw new Error("fixture launch failure") },
  },
  name: "gemini",
  model: "gemini-3.8-flash",
})
const failureActivation = await failureGemini.start({
  cwd: "C:/delegated-project",
  prompt: [{ type: "text", text: "Fail this task." }],
  signal: new AbortController().signal,
})
const failureResult = await failureActivation.result
assert.equal(failureResult.stopReason, "error")
assert.match(failureResult.diagnostic, /fixture launch failure/)
await failureActivation.dispose()

let windowsLaunch
let windowsLookup
const windowsProject = resolve("fixtures", "project")
const windowsNpm = resolve("fixtures", "npm")
const windowsSubprocess = {
  async terminalEnvironment() { return { platform: "windows" } },
  async resolveExecutable(command) {
    if (command === "where.exe") return "C:/Windows/System32/where.exe"
    if (command === "node.exe") return "C:/Program Files/nodejs/node.exe"
    throw new Error(`Unexpected executable lookup: ${command}`)
  },
  spawn(spec) {
    const isLookup = spec.argv.includes("gemini.cmd")
    if (isLookup) windowsLookup = spec
    else windowsLaunch = spec
    const output = isLookup
      ? `${join(windowsProject, "gemini.cmd")}\r\n${join(windowsNpm, "gemini.cmd")}\r\n`
      : stdout
    return {
      done: Promise.resolve({ exitCode: 0, signal: null }),
      async waitForExit() {},
      collected: {
        stdout: { readFrom() { return { text: output, nextOffset: Buffer.byteLength(output), lossy: false } } },
        stderr: { readFrom() { return { text: "", nextOffset: 0, lossy: false } } },
      },
    }
  },
}
await runGeminiTask({ subprocess: windowsSubprocess, task: "windows fixture", cwd: windowsProject, model: "gemini-3.1-pro-preview" })
assert.deepEqual(windowsLookup.argv, ["C:/Windows/System32/where.exe", "gemini.cmd"])
assert.equal(windowsLaunch.argv[0], "C:/Program Files/nodejs/node.exe")
assert.equal(windowsLaunch.argv[1], join(windowsNpm, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js"))
assert.equal(windowsLaunch.argv[2], "--prompt")
assert.ok(windowsLaunch.argv.includes("gemini-3.1-pro-preview"))
assert.deepEqual(windowsLaunch.stdio.stdin, { data: "windows fixture" })

console.log("Gemini CLI provider smoke tests passed")
