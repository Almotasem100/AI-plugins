import assert from "node:assert/strict"
import childProcess from "node:child_process"
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { basename, delimiter, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { runGeminiImageTask, runGeminiTask, validateModel } from "../src/gemini.js"
import { createGeminiLanguageModel } from "../src/provider.js"

async function createFakeGemini(commandDirectory, cliSource) {
  if (process.platform === "win32") {
    const cliEntryPoint = join(commandDirectory, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
    await mkdir(join(commandDirectory, "node_modules", "@google", "gemini-cli", "bundle"), { recursive: true })
    await writeFile(join(commandDirectory, "gemini.cmd"), "@echo off\r\n")
    await writeFile(cliEntryPoint, cliSource)
    return
  }

  const executable = join(commandDirectory, "gemini")
  await writeFile(executable, `#!/usr/bin/env node\n${cliSource}\n`)
  await chmod(executable, 0o755)
}

async function createFakeProject() {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "opencode-gemini-test-"))
  const commandDirectory = join(temporaryRoot, "bin")
  const projectDirectory = join(temporaryRoot, "project")
  await mkdir(commandDirectory)
  await mkdir(projectDirectory)
  return { temporaryRoot, commandDirectory, projectDirectory }
}

async function removeFakeProject(temporaryRoot) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(temporaryRoot, { recursive: true, force: true })
      return
    } catch (error) {
      if (error.code !== "EBUSY" || attempt === 19) throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
}

async function withFakeGemini(cliSource, runTest) {
  const project = await createFakeProject()
  const originalPath = process.env.PATH
  try {
    await createFakeGemini(project.commandDirectory, cliSource)
    process.env.PATH = `${project.commandDirectory}${delimiter}${originalPath ?? ""}`
    return await runTest(project)
  } finally {
    process.env.PATH = originalPath
    await removeFakeProject(project.temporaryRoot)
  }
}

function setEnvironment(values) {
  const saved = {}
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key]
    process.env[key] = value
  }
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function withUnavailableTaskkill(temporaryRoot, runTest) {
  const spawn = childProcess.spawn
  const unavailableTaskkill = join(temporaryRoot, "missing-system-root", "taskkill.exe")
  // Fail only the cleanup subprocess; Node itself needs the real SystemRoot.
  childProcess.spawn = (command, args, options) =>
    spawn(basename(command).toLowerCase() === "taskkill.exe" ? unavailableTaskkill : command, args, options)
  syncBuiltinESMExports()
  try {
    return await runTest()
  } finally {
    childProcess.spawn = spawn
    syncBuiltinESMExports()
  }
}

async function waitForFile(file) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      await access(file)
      return
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  throw new Error("Fake Gemini process did not start.")
}

async function waitForCondition(condition, description) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${description}.`)
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === "ESRCH") return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`Fake Gemini child process ${pid} did not exit.`)
}

function streamJsonSource(events) {
  return `for (const event of ${JSON.stringify(events)}) process.stdout.write(JSON.stringify(event) + '\\n')`
}

test("text responses stream before the CLI finishes", async () => {
  const streamReady = join(tmpdir(), `opencode-gemini-stream-${process.pid}-${Date.now()}`)
  const releaseFile = `${streamReady}-release`
  const restoreEnvironment = setEnvironment({
    GEMINI_TEST_READY_FILE: streamReady,
    GEMINI_TEST_RELEASE_FILE: releaseFile,
  })
  const source = `
    const fs = require('node:fs')
    const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n')
    emit({type:'init',session_id:'test',model:'test'})
    emit({type:'message',role:'assistant',content:'first ',delta:true})
    fs.writeFileSync(process.env.GEMINI_TEST_READY_FILE, 'ready')
    const timer = setInterval(() => {
      if (!fs.existsSync(process.env.GEMINI_TEST_RELEASE_FILE)) return
      clearInterval(timer)
      emit({type:'message',role:'assistant',content:'second',delta:true})
      emit({type:'result',status:'success',stats:{}})
    }, 5)`
  const chunks = []
  let settled = false

  try {
    await withFakeGemini(source, async (project) => {
      const execution = runGeminiTask({
        task: "stream this",
        cwd: project.projectDirectory,
        onText: (chunk) => chunks.push(chunk),
      })
      execution.then(
        () => { settled = true },
        () => { settled = true },
      )
      await waitForFile(streamReady)
      await waitForCondition(() => chunks.length === 1, "the first text chunk")
      assert.deepEqual(chunks, ["first "])
      assert.equal(settled, false)
      await writeFile(releaseFile, "release")
      assert.equal(await execution, "first second")
    })
    assert.deepEqual(chunks, ["first ", "second"])
  } finally {
    restoreEnvironment()
    await rm(streamReady, { force: true })
    await rm(releaseFile, { force: true })
  }
})

test("fragmented JSONL and split UTF-8 are reassembled", async () => {
  const events = [
    { type: "message", role: "assistant", content: "héllo 🌍", delta: true },
    { type: "result", status: "success", stats: {} },
  ]
  const payload = Buffer.from(events.map((event) => JSON.stringify(event)).join("\n") + "\n")
  const splitAt = payload.indexOf(Buffer.from("🌍")) + 2
  const chunks = [payload.subarray(0, splitAt), payload.subarray(splitAt)].map((chunk) => chunk.toString("base64"))
  const source = `
    const chunks = ${JSON.stringify(chunks)}
    let index = 0
    const next = () => {
      if (index === chunks.length) return
      process.stdout.write(Buffer.from(chunks[index++], 'base64'))
      setTimeout(next, 10)
    }
    next()`
  const received = []

  await withFakeGemini(source, async (project) => {
    const text = await runGeminiTask({
      task: "fragment this",
      cwd: project.projectDirectory,
      onText: (chunk) => received.push(chunk),
    })
    assert.equal(text, "héllo 🌍")
  })
  assert.deepEqual(received, ["héllo 🌍"])
})

test("a nonfatal error event does not fail a successful result", async () => {
  const source = streamJsonSource([
    { type: "error", severity: "error", message: "Rate limit warning, continuing" },
    { type: "message", role: "assistant", content: "finished", delta: true },
    { type: "result", status: "success", stats: {} },
  ])
  const text = await withFakeGemini(source, ({ projectDirectory }) =>
    runGeminiTask({ task: "keep going", cwd: projectDirectory }),
  )
  assert.equal(text, "finished")
})

test("a max-turns error event makes a successful result fail", async () => {
  const chunks = []
  const source = streamJsonSource([
    { type: "message", role: "assistant", content: "partial response", delta: true },
    { type: "error", severity: "error", message: "Maximum session turns exceeded" },
    { type: "result", status: "success", stats: {} },
  ])
  await withFakeGemini(source, ({ projectDirectory }) =>
    assert.rejects(
      runGeminiTask({
        task: "reach turn limit",
        cwd: projectDirectory,
        onText: (chunk) => chunks.push(chunk),
      }),
      /reached its session turn limit/,
    ),
  )
  assert.deepEqual(chunks, ["partial response"])
})

test("a terminal result error after partial output is not a success", async () => {
  const chunks = []
  const source = streamJsonSource([
    { type: "message", role: "assistant", content: "partial", delta: true },
    { type: "error", severity: "error", message: "Safety blocked" },
    { type: "result", status: "error", error: { type: "INVALID_STREAM", message: "Safety blocked" }, stats: {} },
  ])
  await withFakeGemini(source, async ({ projectDirectory }) => {
    await assert.rejects(
      runGeminiTask({
        task: "stop midway",
        cwd: projectDirectory,
        onText: (chunk) => chunks.push(chunk),
      }),
      /Gemini CLI reported a failure\./,
    )
  })
  assert.deepEqual(chunks, ["partial"])
})

test("a terminal result without an error payload uses the preceding error event", async () => {
  const source = streamJsonSource([
    { type: "error", severity: "error", message: "The response was blocked by safety filters." },
    { type: "result", status: "error", stats: {} },
  ])
  await withFakeGemini(source, ({ projectDirectory }) =>
    assert.rejects(runGeminiTask({ task: "blocked", cwd: projectDirectory }), /Gemini CLI reported a failure\./),
  )
})

test("protocol and process failures are actionable without exposing raw stderr", async () => {
  const apiKey = `AIza${"a".repeat(35)}`
  const failureCases = [
    {
      source: "process.stdout.write('not json\\n'); setInterval(() => {}, 1000)",
      expected: /not valid stream-json/,
      absentCleanupFailure: true,
    },
    {
      source: `process.stderr.write(${JSON.stringify(`failed with ${apiKey}`)});process.exitCode = 4`,
      expected: /exited with code 4 before reporting a final result/,
      absent: /AIza/,
    },
    {
      source: "process.exitCode = 42",
      expected: /Gemini CLI rejected the request/,
    },
    {
      source: "process.exitCode = 53",
      expected: /Gemini CLI reached its session turn limit/,
    },
    {
      source: streamJsonSource([{ type: "message", role: "assistant", content: "done", delta: true }]),
      expected: /before reporting a final result/,
    },
    {
      source: `${streamJsonSource([
        { type: "message", role: "assistant", content: "done", delta: true },
        { type: "result", status: "success", stats: {} },
      ])};process.exitCode = 1`,
      expected: /exited with code 1/,
    },
  ]

  for (const failureCase of failureCases) {
    await withFakeGemini(failureCase.source, async ({ projectDirectory }) => {
      const failure = await runGeminiTask({ task: "fail", cwd: projectDirectory }).catch((error) => error)
      assert.match(failure.message, failureCase.expected)
      if (failureCase.absent) assert.doesNotMatch(failure.message, failureCase.absent)
      if (failureCase.absentCleanupFailure) {
        assert.doesNotMatch(failure.message, /process-tree cleanup also failed/i)
      }
    })
  }
})

test("a real taskkill failure is reported without hiding the protocol error", {
  skip: process.platform !== "win32",
  timeout: 15_000,
}, async () => {
  await withFakeGemini(
    "process.stdout.write('not json\\n'); setInterval(() => {}, 1000)",
    ({ projectDirectory, temporaryRoot }) =>
      withUnavailableTaskkill(temporaryRoot, async () => {
        const failure = await runGeminiTask({
          task: "exercise cleanup failure",
          cwd: projectDirectory,
        }).catch((error) => error)

        assert.ok(failure instanceof AggregateError)
        assert.match(failure.message, /not valid stream-json/)
        assert.match(failure.message, /process-tree cleanup also failed/i)
        assert.match(failure.errors[0].message, /not valid stream-json/)
        assert.match(failure.errors[1].message, /process-tree termination failed/i)
      }),
  )
})

test("an exited Windows CLI root does not count as successful tree cleanup", {
  skip: process.platform !== "win32",
  timeout: 15_000,
}, async () => {
  const readyFile = join(tmpdir(), `opencode-gemini-orphan-${process.pid}-${Date.now()}`)
  const heartbeatFile = `${readyFile}-heartbeat`
  const triggerFile = `${readyFile}-trigger`
  const emittedFile = `${readyFile}-emitted`
  const restoreEnvironment = setEnvironment({
    GEMINI_TEST_READY_FILE: readyFile,
    GEMINI_TEST_HEARTBEAT_FILE: heartbeatFile,
    GEMINI_TEST_TRIGGER_FILE: triggerFile,
    GEMINI_TEST_EMITTED_FILE: emittedFile,
  })
  let descendantPID

  const descendantSource = `
    const fs = require('node:fs')
    const readyFile = ${JSON.stringify(readyFile)}
    const heartbeatFile = ${JSON.stringify(heartbeatFile)}
    const triggerFile = ${JSON.stringify(triggerFile)}
    const emittedFile = ${JSON.stringify(emittedFile)}
    fs.writeFileSync(readyFile, String(process.pid))
    let count = 0
    const beat = () => fs.writeFileSync(heartbeatFile, String(++count))
    beat()
    setInterval(() => {
      if (fs.existsSync(triggerFile)) {
        fs.unlinkSync(triggerFile)
        process.stdout.write('not json\\n', () => fs.writeFileSync(emittedFile, 'emitted'))
      }
      beat()
    }, 20)
  `
  const source = `
    const fs = require('node:fs')
    const { spawn } = require('node:child_process')
    const descendantSource = ${JSON.stringify(descendantSource)}
    const child = spawn(process.execPath, ['-e', descendantSource], {
      detached: true,
      stdio: ['ignore', 'inherit', 'ignore'],
      windowsHide: true,
    })
    fs.writeFileSync(process.env.GEMINI_TEST_ROOT_PID_FILE, JSON.stringify({ root: process.pid, child: child.pid }))
    let attempts = 0
    const started = setInterval(() => {
      if (!fs.existsSync(process.env.GEMINI_TEST_READY_FILE) && attempts++ < 300) return
      clearInterval(started)
      process.exit(0)
    }, 10)
  `
  const rootPIDFile = `${readyFile}-pids`
  const restorePIDFile = setEnvironment({ GEMINI_TEST_ROOT_PID_FILE: rootPIDFile })

  try {
    await withFakeGemini(source, async ({ projectDirectory }) => {
      try {
        const execution = runGeminiTask({ task: "detect orphan cleanup", cwd: projectDirectory })
          .catch((error) => error)
        await waitForFile(rootPIDFile)
        const { root, child } = JSON.parse(await readFile(rootPIDFile, "utf8"))
        descendantPID = child
        await waitForProcessExit(root)
        await waitForFile(readyFile)
        await waitForFile(heartbeatFile)
        await writeFile(triggerFile, "emit failure")

        await waitForFile(emittedFile)
        const heartbeatAtFailure = await readFile(heartbeatFile, "utf8")
        await new Promise((resolve) => setTimeout(resolve, 100))
        assert.notEqual(await readFile(heartbeatFile, "utf8"), heartbeatAtFailure)
        let timeout
        const failure = await Promise.race([
          execution,
          new Promise((resolve) => { timeout = setTimeout(() => resolve(undefined), 6_000) }),
        ])
        clearTimeout(timeout)
        assert.ok(failure, "failed request cleanup must settle while the descendant still holds stdout")
        assert.doesNotThrow(() => process.kill(descendantPID, 0))
        assert.ok(failure instanceof AggregateError)
        assert.match(failure.message, /not valid stream-json/)
        assert.match(failure.message, /process-tree cleanup also failed/i)
        assert.match(failure.errors[1].message, /process cleanup was incomplete/i)
        assert.ok(failure.errors[1].errors.some((error) => /termination failed/i.test(error.message)))
        assert.ok(failure.errors[1].errors.some((error) => /stdio did not close/i.test(error.message)))
      } finally {
        if (descendantPID) {
          try {
            process.kill(descendantPID, "SIGKILL")
          } catch (error) {
            if (error.code !== "ESRCH") throw error
          }
          await waitForProcessExit(descendantPID).catch((error) => {
            if (!/did not exit/.test(error.message)) throw error
          })
        }
      }
    })
  } finally {
    restorePIDFile()
    restoreEnvironment()
    await rm(rootPIDFile, { force: true })
    await rm(readyFile, { force: true })
    await rm(heartbeatFile, { force: true })
    await rm(triggerFile, { force: true })
    await rm(emittedFile, { force: true })
  }
})

test("ACP cleanup failure does not hide the request error", {
  skip: process.platform !== "win32",
  timeout: 15_000,
}, async () => {
  const source = `
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        send({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})
      }
      if (message.method === 'session/new') {
        send({jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'password: "synthetic secret phrase" at https://example.test/?key=url-query-secret'}})
        setInterval(() => {}, 1000)
      }
    })`

  await withFakeGemini(source, ({ projectDirectory, temporaryRoot }) =>
    withUnavailableTaskkill(temporaryRoot, async () => {
      const failure = await runGeminiImageTask({
        task: "describe",
        images: [],
        cwd: projectDirectory,
      }).catch((error) => error)

  assert.ok(failure instanceof AggregateError)
  assert.match(failure.message, /ACP request failed/)
  assert.match(failure.message, /process-tree cleanup also failed/i)
  assert.doesNotMatch(failure.message, /synthetic secret phrase|url-query-secret/)
      assert.match(failure.errors[0].message, /ACP request failed/)
      assert.match(failure.errors[1].message, /process-tree termination failed/i)
    }),
  )
})

test("cancellation during ACP cleanup preserves cleanup failure", {
  skip: process.platform !== "win32",
  timeout: 15_000,
}, async () => {
  const controller = new AbortController()
  const source = `
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        send({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})
      }
      if (message.method === 'session/new') {
        send({jsonrpc:'2.0',id:message.id,result:{sessionId:'test'}})
      }
      if (message.method === 'session/prompt') {
        const update = {jsonrpc:'2.0',method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'answer'}}}}
        const result = {jsonrpc:'2.0',id:message.id,result:{stopReason:'end_turn'}}
        process.stdout.write(JSON.stringify(update) + '\\n' + JSON.stringify(result) + '\\n')
      }
    })
    setInterval(() => {}, 1000)`

  try {
    await withFakeGemini(source, ({ projectDirectory, temporaryRoot }) =>
      withUnavailableTaskkill(temporaryRoot, async () => {
        const failure = await runGeminiImageTask({
          task: "describe",
          images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
          cwd: projectDirectory,
          signal: controller.signal,
          onText: () => setImmediate(() => controller.abort()),
        }).catch((error) => error)

        assert.ok(failure instanceof AggregateError)
        assert.match(failure.errors[0].message, /cancelled/)
        assert.match(failure.errors[1].message, /process-tree termination failed/)
      }),
    )
  } finally {
    controller.abort()
  }
})

test("authentication and quota failures use fixed guidance without exposing diagnostic credentials", async () => {
  const apiKey = `AIza${"a".repeat(35)}`
  const auth = await withFakeGemini(
    streamJsonSource([
      {
        type: "result",
        status: "error",
        error: {
          type: "FatalAuthenticationError",
          message: `Login required with ${apiKey}; password: "synthetic secret phrase"; https://example.test/?access_token=url-query-secret`,
        },
        stats: {},
      },
    ]),
    ({ projectDirectory }) => runGeminiTask({ task: "authenticate", cwd: projectDirectory }).catch((error) => error),
  )
  assert.match(auth.message, /authentication failed/)
  assert.match(auth.message, /sign in again/)
  for (const secret of [apiKey, "synthetic secret phrase", "url-query-secret"]) {
    assert.doesNotMatch(auth.message, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }

  const quota = await withFakeGemini(
    streamJsonSource([
      {
        type: "result",
        status: "error",
        error: { type: "FatalError", message: "[API Error: You exceeded your current quota (Status: 429)]" },
        stats: {},
      },
    ]),
    ({ projectDirectory }) => runGeminiTask({ task: "quota", cwd: projectDirectory }).catch((error) => error),
  )
  assert.match(quota.message, /quota or rate limit/)
  assert.match(quota.message, /Wait before retrying/)
})

test("unclassified diagnostics do not forward quoted secrets or URL query credentials", async () => {
  const diagnostic = 'Rejected request with password: "synthetic secret phrase" at https://example.test/?key=url-query-secret&token=second-query-secret'
  const source = streamJsonSource([
    { type: "result", status: "error", error: { type: "FatalError", message: diagnostic }, stats: {} },
  ])
  const failure = await withFakeGemini(source, ({ projectDirectory }) =>
    runGeminiTask({ task: "check diagnostic privacy", cwd: projectDirectory }).catch((error) => error),
  )

  assert.equal(failure.message, "Gemini CLI reported a failure.")
  for (const secret of ["synthetic secret phrase", "url-query-secret", "second-query-secret"]) {
    assert.equal(failure.message.includes(secret), false)
  }
})

test("validateModel accepts a model ID and rejects option-like input", () => {
  assert.equal(validateModel("gemini-3.1-pro"), "gemini-3.1-pro")
  assert.equal(validateModel(undefined), undefined)
  assert.throws(() => validateModel("--yolo"), /Model must be a Gemini CLI model ID/)
})

test("plugin launches Gemini in the project directory with streamed output and YOLO approval mode", async () => {
  const source = `
    let task = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => task += chunk)
    process.stdin.on('end', () => {
      const result = { task, cwd: process.cwd(), args: process.argv.slice(2) }
      process.stdout.write(JSON.stringify({type:'message',role:'assistant',content:JSON.stringify(result),delta:true}) + '\\n')
      process.stdout.write(JSON.stringify({type:'result',status:'success',stats:{}}) + '\\n')
    })`

  let projectDirectory
  const response = await withFakeGemini(source, async (project) => {
    projectDirectory = project.projectDirectory
    await createFakeGemini(project.projectDirectory, "process.stdout.write('wrong executable')")
    process.env.PATH = `${project.projectDirectory}${delimiter}${process.env.PATH ?? ""}`
    return runGeminiTask({ task: "inspect this project", cwd: project.projectDirectory })
  })
  const cliResult = JSON.parse(response)
  assert.equal(cliResult.task, "inspect this project")
  assert.equal(cliResult.cwd, projectDirectory)
  assert.ok(cliResult.args.includes("--approval-mode=yolo"))
  assert.ok(cliResult.args.includes("stream-json"))
})

test("oversized CLI output stops a still-running CLI and its process tree", { timeout: 15_000 }, async () => {
  const readyFile = join(tmpdir(), `opencode-gemini-overflow-${process.pid}-${Date.now()}`)
  const heartbeatFile = `${readyFile}-heartbeat`
  const restoreEnvironment = setEnvironment({
    GEMINI_TEST_READY_FILE: readyFile,
    GEMINI_TEST_HEARTBEAT_FILE: heartbeatFile,
  })
  // The heartbeat child keeps running and only starts the oversized write once it
  // exists, so a passing assertion proves the whole process tree stopped.
  const source = [
    "const fs = require('node:fs')",
    "const {spawn} = require('node:child_process')",
    "process.on('SIGTERM', () => process.exit(0))",
    "const childSource = `const fs=require('node:fs');process.on('SIGTERM',()=>{});let count=0;const beat=()=>fs.writeFileSync(process.env.GEMINI_TEST_HEARTBEAT_FILE,String(++count));beat();setInterval(beat,20)`",
    "spawn(process.execPath, ['-e', childSource], {stdio: 'ignore'})",
    "const heartbeat = process.env.GEMINI_TEST_HEARTBEAT_FILE",
    "const timer = setInterval(() => {",
    "  if (!fs.existsSync(heartbeat)) return",
    "  clearInterval(timer)",
    "  fs.writeFileSync(process.env.GEMINI_TEST_READY_FILE, 'ready')",
    "  const chunk = 'x'.repeat(1024 * 1024)",
    "  let remaining = 17",
    "  function writeNext() {",
    "    if (remaining-- === 0) return",
    "    process.stdout.write(chunk, writeNext)",
    "  }",
    "  writeNext()",
    "}, 10)",
  ].join("\n")

  try {
    await withFakeGemini(source, async ({ projectDirectory }) => {
      const execution = runGeminiTask({ task: "produce too much output", cwd: projectDirectory })
      await waitForFile(readyFile)
      await assert.rejects(execution, /exceeded the 16 MiB limit/)
      const stoppedAt = await readFile(heartbeatFile, "utf8")
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(await readFile(heartbeatFile, "utf8"), stoppedAt)
    })
  } finally {
    restoreEnvironment()
    await rm(readyFile, { force: true })
    await rm(heartbeatFile, { force: true })
  }
})

test("spawn errors preserve useful codes without exposing paths", async () => {
  await withFakeGemini("process.stdout.write('unexpected launch')", async ({ projectDirectory }) => {
    const cwd = join(projectDirectory, "missing")
    for (const failure of [
      await runGeminiTask({ task: "fail before the fake CLI starts", cwd }).catch((error) => error),
      await runGeminiImageTask({ task: "describe", images: [], cwd }).catch((error) => error),
    ]) {
      assert.equal(failure.code, "ENOENT")
      assert.match(failure.message, /Gemini CLI could not start \(ENOENT\)/)
      assert.doesNotMatch(failure.message, /missing|opencode-gemini-test-/)
      assert.ok(failure.message.length < 100)
    }
  })
})

test("cancellation stops the process tree after partial streamed output", { timeout: 15_000 }, async () => {
  const readyFile = join(tmpdir(), `opencode-gemini-cancel-${process.pid}-${Date.now()}`)
  const heartbeatFile = `${readyFile}-heartbeat`
  const restoreEnvironment = setEnvironment({
    GEMINI_TEST_READY_FILE: readyFile,
    GEMINI_TEST_HEARTBEAT_FILE: heartbeatFile,
  })
  const source = [
    "const fs = require('node:fs')",
    "const {spawn} = require('node:child_process')",
    "process.on('SIGTERM', () => process.exit(0))",
    "const childSource = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.env.GEMINI_TEST_READY_FILE,'ready');let count=0;setInterval(()=>fs.writeFileSync(process.env.GEMINI_TEST_HEARTBEAT_FILE,String(++count)),20)`",
    "spawn(process.execPath, ['-e', childSource], {stdio: 'ignore'})",
    "process.stdout.write(JSON.stringify({type:'message',role:'assistant',content:'before cancel',delta:true}) + '\\n')",
  ].join("\n")
  const controller = new AbortController()
  const chunks = []

  try {
    await withFakeGemini(source, async ({ projectDirectory }) => {
      const execution = runGeminiTask({
        task: "run until cancelled",
        cwd: projectDirectory,
        signal: controller.signal,
        onText: (chunk) => chunks.push(chunk),
      })
      await waitForFile(readyFile)
      await waitForCondition(() => chunks.length === 1, "the partial chunk")
      controller.abort()
      await assert.rejects(execution, /cancelled/)
      const stoppedAt = await readFile(heartbeatFile, "utf8")
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(await readFile(heartbeatFile, "utf8"), stoppedAt)
    })
    assert.deepEqual(chunks, ["before cancel"])
  } finally {
    controller.abort()
    restoreEnvironment()
    await rm(readyFile, { force: true })
    await rm(heartbeatFile, { force: true })
  }
})

test("cancelling the provider stream stops its fake Gemini subprocess tree", { timeout: 15_000 }, async () => {
  const readyFile = join(tmpdir(), `opencode-gemini-provider-cancel-${process.pid}-${Date.now()}`)
  const heartbeatFile = `${readyFile}-heartbeat`
  const restoreEnvironment = setEnvironment({
    GEMINI_TEST_READY_FILE: readyFile,
    GEMINI_TEST_HEARTBEAT_FILE: heartbeatFile,
  })
  const source = [
    "const fs = require('node:fs')",
    "const {spawn} = require('node:child_process')",
    "const childSource = `const fs=require('node:fs');const readyTmp=process.env.GEMINI_TEST_READY_FILE+'.tmp';fs.writeFileSync(readyTmp,String(process.pid));fs.renameSync(readyTmp,process.env.GEMINI_TEST_READY_FILE);let count=0;const beat=()=>{const tmp=process.env.GEMINI_TEST_HEARTBEAT_FILE+'.tmp';fs.writeFileSync(tmp,String(++count));fs.renameSync(tmp,process.env.GEMINI_TEST_HEARTBEAT_FILE)};beat();setInterval(beat,20)`",
    "spawn(process.execPath, ['-e', childSource], {stdio: 'ignore'})",
    "process.stdout.write(JSON.stringify({type:'message',role:'assistant',content:'partial response',delta:true}) + '\\n')",
    "process.stdin.resume()",
  ].join("\n")
  const controller = new AbortController()
  let reader

  try {
    await withFakeGemini(source, async ({ projectDirectory }) => {
      const model = createGeminiLanguageModel({ modelID: "gemini-3.8-flash", cwd: projectDirectory })
      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: "stream until cancelled" }],
        abortSignal: controller.signal,
      })
      reader = stream.getReader()
      const events = []
      for (let index = 0; index < 3; index += 1) events.push((await reader.read()).value)
      assert.deepEqual(events.map((event) => event.type), ["stream-start", "text-start", "text-delta"])
      assert.equal(events[2].delta, "partial response")

      await waitForFile(readyFile)
      await waitForFile(heartbeatFile)
      const childPID = Number(await readFile(readyFile, "utf8"))
      assert.ok(Number.isInteger(childPID) && childPID > 0)
      assert.doesNotThrow(() => process.kill(childPID, 0))
      let cancellationResolved = false
      const cancellation = reader.cancel().then(() => { cancellationResolved = true })
      await Promise.resolve()
      assert.equal(cancellationResolved, false)
      await cancellation
      assert.equal(cancellationResolved, true)
      await waitForProcessExit(childPID)
    })
  } finally {
    controller.abort()
    await reader?.cancel().catch(() => {})
    restoreEnvironment()
    await rm(readyFile, { force: true })
    await rm(heartbeatFile, { force: true })
  }
})

test("image requests complete an ACP exchange with the CLI", async () => {
  const source = `
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const reply = (id, result) => process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,result})+'\\n')
    lines.on('line', line => {
      const m = JSON.parse(line)
      if (m.method === 'initialize') reply(m.id, {protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}})
      if (m.method === 'session/new') reply(m.id, {sessionId:'test'})
      if (m.method === 'session/prompt') {
        const image = m.params.prompt.find(p => p.type === 'image')
        const text = image.mimeType + ':' + image.data
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}})+'\\n')
        reply(m.id, {stopReason:'end_turn'})
      }
    })`

  const result = await withFakeGemini(source, ({ projectDirectory }) =>
    createGeminiLanguageModel({ modelID: "gemini-3.8-flash", cwd: projectDirectory }).doGenerate({
      prompt: [{ role: "user", content: [
        { type: "text", text: "describe" }, { type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
      ] }],
    }),
  )
  assert.equal(result.content[0].text, "image/png:AQID")
})

test("ACP image chunks stream before the prompt completes", async () => {
  const readyFile = join(tmpdir(), `opencode-gemini-acp-${process.pid}-${Date.now()}`)
  const releaseFile = `${readyFile}-release`
  const restoreEnvironment = setEnvironment({
    GEMINI_TEST_READY_FILE: readyFile,
    GEMINI_TEST_RELEASE_FILE: releaseFile,
  })
  const source = `
    const fs = require('node:fs')
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
    const chunk = (text) => send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}})
    lines.on('line', line => {
      const m = JSON.parse(line)
      if (m.method === 'initialize') send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})
      if (m.method === 'session/new') send({jsonrpc:'2.0',id:m.id,result:{sessionId:'test'}})
      if (m.method === 'session/prompt') {
        chunk('first')
        fs.writeFileSync(process.env.GEMINI_TEST_READY_FILE, 'ready')
        const timer = setInterval(() => {
          if (!fs.existsSync(process.env.GEMINI_TEST_RELEASE_FILE)) return
          clearInterval(timer)
          chunk('second')
          send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}})
        }, 5)
      }
    })`
  const chunks = []
  let settled = false

  try {
    await withFakeGemini(source, async ({ projectDirectory }) => {
      const execution = runGeminiImageTask({
        task: "describe",
        images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
        cwd: projectDirectory,
        onText: (chunk) => chunks.push(chunk),
      })
      execution.then(
        () => { settled = true },
        () => { settled = true },
      )
      await waitForFile(readyFile)
      await waitForCondition(() => chunks.length === 1, "the first ACP chunk")
      assert.deepEqual(chunks, ["first"])
      assert.equal(settled, false)
      await writeFile(releaseFile, "release")
      assert.equal(await execution, "firstsecond")
    })
  } finally {
    restoreEnvironment()
    await rm(readyFile, { force: true })
    await rm(releaseFile, { force: true })
  }
})

test("cancellation during ACP teardown emits an error instead of finish", {
  timeout: 15_000,
}, async () => {
  const responseFile = join(tmpdir(), `opencode-gemini-acp-response-${process.pid}-${Date.now()}`)
  const restoreEnvironment = setEnvironment({ GEMINI_TEST_RESPONSE_FILE: responseFile })
  const controller = new AbortController()
  let reader
  const source = `
    const fs = require('node:fs')
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        send({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})
      }
      if (message.method === 'session/new') {
        send({jsonrpc:'2.0',id:message.id,result:{sessionId:'test'}})
      }
      if (message.method === 'session/prompt') {
        const update = {jsonrpc:'2.0',method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'answer'}}}}
        const result = {jsonrpc:'2.0',id:message.id,result:{stopReason:'end_turn'}}
        process.stdout.write(JSON.stringify(update) + '\\n' + JSON.stringify(result) + '\\n', () => {
          fs.writeFileSync(process.env.GEMINI_TEST_RESPONSE_FILE, 'sent')
        })
      }
    })
    setInterval(() => {}, 1000)`

  try {
    await withFakeGemini(source, async ({ projectDirectory }) => {
      const model = createGeminiLanguageModel({ modelID: "gemini-3.8-flash", cwd: projectDirectory })
      const { stream } = await model.doStream({
        prompt: [{ role: "user", content: [
          { type: "text", text: "describe" },
          { type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
        ] }],
        abortSignal: controller.signal,
      })
      reader = stream.getReader()
      const events = []
      for (let index = 0; index < 3; index += 1) events.push((await reader.read()).value)
      assert.deepEqual(events.map((event) => event.type), ["stream-start", "text-start", "text-delta"])

      await waitForFile(responseFile)
      await new Promise((resolve) => setImmediate(resolve))
      controller.abort()
      for (let next = await reader.read(); !next.done; next = await reader.read()) events.push(next.value)

      const error = events.find((event) => event.type === "error")
      assert.ok(error)
      assert.match(error.error.message, /cancelled/)
      assert.equal(events.some((event) => event.type === "finish"), false)
    })
  } finally {
    controller.abort()
    await reader?.cancel().catch(() => {})
    restoreEnvironment()
    await rm(responseFile, { force: true })
  }
})

test("late ACP cancellation preserves the earlier request failure", {
  timeout: 15_000,
}, async () => {
  const responseFile = join(tmpdir(), `opencode-gemini-acp-failure-${process.pid}-${Date.now()}`)
  const restoreEnvironment = setEnvironment({ GEMINI_TEST_RESPONSE_FILE: responseFile })
  const controller = new AbortController()
  let reader
  const source = `
    const fs = require('node:fs')
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        send({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({
          jsonrpc:'2.0',id:message.id,error:{code:-32000,message:'request rejected'}
        }) + '\\n', () => fs.writeFileSync(process.env.GEMINI_TEST_RESPONSE_FILE, 'sent'))
      }
    })
    setInterval(() => {}, 1000)`

  try {
    await withFakeGemini(source, async (project) => {
      const exerciseBoundary = async () => {
        const originalSetTimeout = globalThis.setTimeout
        const originalProcessKill = process.kill
        let cleanupAbortScheduled = false
        const abortDuringCleanup = () => {
          if (cleanupAbortScheduled) return
          cleanupAbortScheduled = true
          queueMicrotask(() => controller.abort())
        }
        globalThis.setTimeout = function (callback, delay, ...args) {
          if (delay === 2_000) abortDuringCleanup()
          return originalSetTimeout.call(this, callback, delay, ...args)
        }
        if (process.platform !== "win32") {
          process.kill = function (pid, signal) {
            if (pid < 0 && signal === "SIGTERM") abortDuringCleanup()
            return originalProcessKill.call(this, pid, signal)
          }
        }

        try {
          const model = createGeminiLanguageModel({ modelID: "gemini-3.8-flash", cwd: project.projectDirectory })
          const { stream } = await model.doStream({
            prompt: [{ role: "user", content: [
              { type: "text", text: "describe" },
              { type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
            ] }],
            abortSignal: controller.signal,
          })
          reader = stream.getReader()
          const events = []
          for (let index = 0; index < 3; index += 1) events.push((await reader.read()).value)

          await waitForFile(responseFile)
          for (let next = await reader.read(); !next.done; next = await reader.read()) events.push(next.value)
          const error = events.find((event) => event.type === "error")
          assert.ok(cleanupAbortScheduled, "cancellation must be injected at process cleanup")
          assert.ok(error)
          assert.match(error.error.message, /ACP request failed/)
          assert.doesNotMatch(error.error.message, /cancelled/)
          assert.equal(events.some((event) => event.type === "finish"), false)
        } finally {
          globalThis.setTimeout = originalSetTimeout
          process.kill = originalProcessKill
        }
      }

      if (process.platform === "win32") {
        await withUnavailableTaskkill(project.temporaryRoot, exerciseBoundary)
      } else {
        await exerciseBoundary()
      }
    })
  } finally {
    controller.abort()
    await reader?.cancel().catch(() => {})
    restoreEnvironment()
    await rm(responseFile, { force: true })
  }
})

test("ACP client requests are rejected instead of auto-approved", async () => {
  const captureFile = join(tmpdir(), `opencode-gemini-acp-client-${process.pid}-${Date.now()}`)
  const restoreEnvironment = setEnvironment({ GEMINI_TEST_CAPTURE_FILE: captureFile })
  const source = `
    const fs = require('node:fs')
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
    let promptId
    const clientResponses = []
    lines.on('line', line => {
      const m = JSON.parse(line)
      if (m.method === 'initialize') send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})
      if (m.method === 'session/new') send({jsonrpc:'2.0',id:m.id,result:{sessionId:'test'}})
      if (m.method === 'session/prompt') {
        promptId = m.id
        send({jsonrpc:'2.0',id:99,method:'session/request_permission',params:{sessionId:'test'}})
        send({jsonrpc:'2.0',id:100,method:'session/update',params:{sessionId:'test'}})
      }
      if (m.id === 99 || m.id === 100) {
        clientResponses.push(m)
      }
      if (clientResponses.length === 2) {
        fs.writeFileSync(process.env.GEMINI_TEST_CAPTURE_FILE, JSON.stringify(clientResponses))
        send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'test',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'done'}}}})
        send({jsonrpc:'2.0',id:promptId,result:{stopReason:'end_turn'}})
      }
    })`

  try {
    const text = await withFakeGemini(source, ({ projectDirectory }) =>
      runGeminiImageTask({
        task: "describe",
        images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
        cwd: projectDirectory,
        signal: AbortSignal.timeout(5_000),
      }),
    )
    assert.equal(text, "done")
    const responses = JSON.parse(await readFile(captureFile, "utf8"))
    assert.deepEqual(responses.map(({ id, error }) => [id, error.code]), [[99, -32601], [100, -32601]])
    assert.ok(responses.every((response) => !Object.hasOwn(response, "result")))
  } finally {
    restoreEnvironment()
    await rm(captureFile, { force: true })
  }
})

test("ACP rejects invalid JSON-RPC envelopes and unmatched or malformed responses", { timeout: 15_000 }, async (t) => {
  const cases = [
    ["wrong JSON-RPC version", "send({jsonrpc:'1.0',method:'session/update',params:{sessionId:'test',update:{}}})", true],
    ["unmatched response ID", "send({jsonrpc:'2.0',id:999,result:{}})", true],
    ["response with both result and error", "send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1},error:{code:-1,message:'failed'}})"],
    ["response with neither result nor error", "send({jsonrpc:'2.0',id:m.id})"],
  ]

  for (const [scenario, response, afterInitialize] of cases) {
    await t.test(scenario, async () => {
      const source = `
        const readline = require('node:readline')
        const lines = readline.createInterface({ input: process.stdin })
        const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
        lines.on('line', line => {
          const m = JSON.parse(line)
          if (m.method === 'initialize') {
            ${afterInitialize ? "send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})" : response}
            ${afterInitialize ? response : ""}
          }
          if (m.method === 'session/new') send({jsonrpc:'2.0',id:m.id,result:{sessionId:'active-session'}})
          if (m.method === 'session/prompt') {
            send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'active-session',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'answer'}}}})
            send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}})
          }
        })`

      await withFakeGemini(source, ({ projectDirectory }) =>
        assert.rejects(runGeminiImageTask({
          task: "describe",
          images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
          cwd: projectDirectory,
        }), /not valid JSON-RPC/),
      )
    })
  }
})

test("ACP ignores image updates from sessions other than the active session", async () => {
  const source = `
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
    lines.on('line', line => {
      const m = JSON.parse(line)
      if (m.method === 'initialize') {
        send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})
      }
      if (m.method === 'session/new') send({jsonrpc:'2.0',id:m.id,result:{sessionId:'active-session'}})
      if (m.method === 'session/prompt') {
        const update = (sessionId, text) => send({jsonrpc:'2.0',method:'session/update',params:{sessionId,update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text}}}})
        update('foreign-session', 'must not leak')
        update('active-session', 'active answer')
        send({jsonrpc:'2.0',id:m.id,result:{stopReason:'end_turn'}})
      }
    })`
  const chunks = []

  const text = await withFakeGemini(source, ({ projectDirectory }) =>
    runGeminiImageTask({
      task: "describe",
      images: [{ type: "image", mimeType: "image/png", data: "AQID" }],
      cwd: projectDirectory,
      onText: (chunk) => chunks.push(chunk),
    }),
  )

  assert.equal(text, "active answer")
  assert.deepEqual(chunks, ["active answer"])
})

test("ACP output that is not JSON-RPC fails with a protocol error", async () => {
  await withFakeGemini("process.stdout.write('not json\\n'); process.stdin.resume()", ({ projectDirectory }) =>
    assert.rejects(
      runGeminiImageTask({ task: "describe", images: [], cwd: projectDirectory }),
      /not valid JSON-RPC/,
    ),
  )
})

test("ACP failure diagnostics stay fixed for credential-bearing provider errors", async () => {
  const apiKey = `AIza${"a".repeat(35)}`
  const source = `
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})+'\\n')
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:-1,message:${JSON.stringify(`${apiKey} ${"x".repeat(1000)}`)}}})+'\\n')
      }
    })`
  const failure = await withFakeGemini(source, ({ projectDirectory }) =>
    runGeminiImageTask({ task: "describe", images: [], cwd: projectDirectory }).catch((error) => error),
  )

  assert.match(failure.message, /ACP request failed/)
  assert.doesNotMatch(failure.message, /AIza/)
  assert.ok(failure.message.length <= 700)
})

test("cancelling an image request stops the ACP process", async () => {
  const readyFile = join(tmpdir(), `opencode-gemini-image-cancel-${process.pid}-${Date.now()}`)
  const restoreEnvironment = setEnvironment({ GEMINI_TEST_READY_FILE: readyFile })
  const controller = new AbortController()

  try {
    await withFakeGemini(
      "require('node:fs').writeFileSync(process.env.GEMINI_TEST_READY_FILE, 'ready'); process.stdin.resume()",
      async ({ projectDirectory }) => {
        const execution = runGeminiImageTask({
          task: "describe",
          images: [],
          cwd: projectDirectory,
          signal: controller.signal,
        })
        await waitForFile(readyFile)
        controller.abort()
        await assert.rejects(execution, /cancelled/)
      },
    )
  } finally {
    controller.abort()
    restoreEnvironment()
    await rm(readyFile, { force: true })
  }
})

test("ACP end_turn with no response text fails instead of succeeding empty", async () => {
  const source = `
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})+'\\n')
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{sessionId:'sess-empty'}})+'\\n')
      }
      if (message.method === 'session/prompt') {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{stopReason:'end_turn'}})+'\\n')
      }
    })`
  await withFakeGemini(source, ({ projectDirectory }) =>
    assert.rejects(
      runGeminiImageTask({ task: "describe", images: [], cwd: projectDirectory }),
      /returned no response text/,
    ),
  )
})

test("ACP classified provider errors report actionable fixed diagnostics without leaking raw payloads", async () => {
  const secretToken = "sk-secret-value-12345"
  const source = `
    const readline = require('node:readline')
    const lines = readline.createInterface({ input: process.stdin })
    lines.on('line', line => {
      const message = JSON.parse(line)
      if (message.method === 'initialize') {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{promptCapabilities:{image:true}}}})+'\\n')
      }
      if (message.method === 'session/new') {
        process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,error:{code:429,message:${JSON.stringify(`RESOURCE_EXHAUSTED ${secretToken}`)}}})+'\\n')
      }
    })`
  const failure = await withFakeGemini(source, ({ projectDirectory }) =>
    runGeminiImageTask({ task: "describe", images: [], cwd: projectDirectory }).catch((error) => error),
  )

  assert.match(failure.message, /quota or rate limit/i)
  assert.doesNotMatch(failure.message, /sk-secret-value/)
})

test("PATH resolution skips an unusable file entry ahead of the real Gemini CLI", async () => {
  await withFakeGemini(
    `process.stdout.write(JSON.stringify({type:'message',role:'assistant',content:'ok',delta:true})+'\\n')
     process.stdout.write(JSON.stringify({type:'result',status:'success'})+'\\n')`,
    async ({ projectDirectory }) => {
      const blockerFile = join(tmpdir(), `opencode-gemini-path-file-${process.pid}-${Date.now()}`)
      const restoreEnv = setEnvironment({ PATH: `${blockerFile}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}` })
      try {
        await writeFile(blockerFile, "not-a-directory")
        const text = await runGeminiTask({ task: "hello", cwd: projectDirectory })
        assert.equal(text, "ok")
      } finally {
        restoreEnv()
        await rm(blockerFile, { force: true })
      }
    },
  )
})
