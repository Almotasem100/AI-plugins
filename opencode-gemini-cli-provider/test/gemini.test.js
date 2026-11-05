import assert from "node:assert/strict"
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { delimiter, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import { parseGeminiOutput, runGeminiTask, validateModel } from "../src/gemini.js"

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

test("parseGeminiOutput returns the CLI's final response", () => {
  assert.equal(parseGeminiOutput(JSON.stringify({ response: "done", stats: {} })), "done")
})

test("parseGeminiOutput surfaces structured CLI errors", () => {
  assert.throws(
    () => parseGeminiOutput(JSON.stringify({ error: { message: "not authenticated" } })),
    /not authenticated/,
  )
})

test("parseGeminiOutput rejects malformed or incomplete output", () => {
  assert.throws(() => parseGeminiOutput("not json"), /invalid JSON/)
  assert.throws(() => parseGeminiOutput(JSON.stringify({ stats: {} })), /did not contain a response string/)
})

test("validateModel accepts a model ID and rejects option-like input", () => {
  assert.equal(validateModel("gemini-3.1-pro"), "gemini-3.1-pro")
  assert.equal(validateModel(undefined), undefined)
  assert.throws(() => validateModel("--yolo"), /Model must be a Gemini CLI model ID/)
})

test("plugin launches Gemini in the project directory with YOLO approval mode", async () => {
  const { temporaryRoot, commandDirectory, projectDirectory } = await createFakeProject()
  const originalPath = process.env.PATH
  const cliSource = [
    "let task = ''",
    "process.stdin.setEncoding('utf8')",
    "process.stdin.on('data', chunk => task += chunk)",
    "process.stdin.on('end', () => {",
    "  const result = { task, cwd: process.cwd(), args: process.argv.slice(2) }",
    "  process.stdout.write(JSON.stringify({ response: JSON.stringify(result) }))",
    "})",
  ].join("\n")

  try {
    await createFakeGemini(commandDirectory, cliSource)
    await createFakeGemini(projectDirectory, "process.stdout.write(JSON.stringify({response: 'wrong executable'}))")
    process.env.PATH = `${projectDirectory}${delimiter}${commandDirectory}${delimiter}${originalPath ?? ""}`

    const response = await runGeminiTask({
      task: "inspect this project",
      cwd: projectDirectory,
    })
    const cliResult = JSON.parse(response)
    assert.equal(cliResult.task, "inspect this project")
    assert.equal(cliResult.cwd, projectDirectory)
    assert.ok(cliResult.args.includes("--approval-mode=yolo"))
  } finally {
    process.env.PATH = originalPath
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("completed CLI failures surface after the process closes", async () => {
  const { temporaryRoot, commandDirectory, projectDirectory } = await createFakeProject()
  const originalPath = process.env.PATH
  const failureCases = [
    { source: "process.stdout.write('not json')", expected: /invalid JSON/ },
    { source: "process.stderr.write('failed');process.exitCode = 4", expected: /exited with code 4/ },
  ]

  try {
    process.env.PATH = `${commandDirectory}${delimiter}${originalPath ?? ""}`
    for (const failureCase of failureCases) {
      await createFakeGemini(commandDirectory, failureCase.source)
      await assert.rejects(
        runGeminiTask({ task: "fail in the fake CLI", cwd: projectDirectory }),
        failureCase.expected,
      )
    }
  } finally {
    process.env.PATH = originalPath
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("oversized CLI output stops a still-running CLI and its process tree", { timeout: 15_000 }, async () => {
  const { temporaryRoot, commandDirectory, projectDirectory } = await createFakeProject()
  const readyFile = join(temporaryRoot, "overflow-ready")
  const heartbeatFile = join(temporaryRoot, "overflow-heartbeat")
  const originalPath = process.env.PATH
  const originalReadyFile = process.env.GEMINI_TEST_READY_FILE
  const originalHeartbeatFile = process.env.GEMINI_TEST_HEARTBEAT_FILE
  // The heartbeat child keeps running and only starts the oversized write once it
  // exists, so a passing assertion proves the whole process tree stopped.
  const cliSource = [
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
  let execution

  try {
    await createFakeGemini(commandDirectory, cliSource)
    process.env.PATH = `${commandDirectory}${delimiter}${originalPath ?? ""}`
    process.env.GEMINI_TEST_READY_FILE = readyFile
    process.env.GEMINI_TEST_HEARTBEAT_FILE = heartbeatFile
    execution = runGeminiTask({ task: "produce too much output", cwd: projectDirectory })
    await waitForFile(readyFile)
    await assert.rejects(execution, /exceeded the 16 MiB limit/)
    const stoppedAt = await readFile(heartbeatFile, "utf8")
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await readFile(heartbeatFile, "utf8"), stoppedAt)
  } finally {
    await execution?.catch(() => {})
    process.env.PATH = originalPath
    if (originalReadyFile === undefined) delete process.env.GEMINI_TEST_READY_FILE
    else process.env.GEMINI_TEST_READY_FILE = originalReadyFile
    if (originalHeartbeatFile === undefined) delete process.env.GEMINI_TEST_HEARTBEAT_FILE
    else process.env.GEMINI_TEST_HEARTBEAT_FILE = originalHeartbeatFile
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("a missing working directory preserves the subprocess launch error", async () => {
  const { temporaryRoot, commandDirectory, projectDirectory } = await createFakeProject()
  const originalPath = process.env.PATH

  try {
    await createFakeGemini(commandDirectory, "process.stdout.write(JSON.stringify({ response: 'unexpected launch' }))")
    process.env.PATH = `${commandDirectory}${delimiter}${originalPath ?? ""}`
    await assert.rejects(
      runGeminiTask({ task: "fail before the fake CLI starts", cwd: join(projectDirectory, "missing") }),
      { code: "ENOENT" },
    )
  } finally {
    process.env.PATH = originalPath
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test("cancellation waits until Gemini's process tree has stopped", async () => {
  const { temporaryRoot, commandDirectory, projectDirectory } = await createFakeProject()
  const readyFile = join(temporaryRoot, "ready")
  const heartbeatFile = join(temporaryRoot, "heartbeat")
  const originalPath = process.env.PATH
  const originalReadyFile = process.env.GEMINI_TEST_READY_FILE
  const originalHeartbeatFile = process.env.GEMINI_TEST_HEARTBEAT_FILE
  const cliSource = [
    "const fs = require('node:fs')",
    "const {spawn} = require('node:child_process')",
    "process.on('SIGTERM', () => process.exit(0))",
    "const childSource = `const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.env.GEMINI_TEST_READY_FILE,'ready');let count=0;setInterval(()=>fs.writeFileSync(process.env.GEMINI_TEST_HEARTBEAT_FILE,String(++count)),20)`",
    "spawn(process.execPath, ['-e', childSource], {stdio: 'ignore'})",
  ].join("\n")
  const controller = new AbortController()
  let execution

  try {
    await createFakeGemini(commandDirectory, cliSource)
    process.env.PATH = `${commandDirectory}${delimiter}${originalPath ?? ""}`
    process.env.GEMINI_TEST_READY_FILE = readyFile
    process.env.GEMINI_TEST_HEARTBEAT_FILE = heartbeatFile
    execution = runGeminiTask({ task: "run until cancelled", cwd: projectDirectory, signal: controller.signal })
    await waitForFile(readyFile)
    controller.abort()
    await assert.rejects(execution, /cancelled/)
    const stoppedAt = await readFile(heartbeatFile, "utf8")
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(await readFile(heartbeatFile, "utf8"), stoppedAt)
  } finally {
    controller.abort()
    await execution?.catch(() => {})
    process.env.PATH = originalPath
    if (originalReadyFile === undefined) delete process.env.GEMINI_TEST_READY_FILE
    else process.env.GEMINI_TEST_READY_FILE = originalReadyFile
    if (originalHeartbeatFile === undefined) delete process.env.GEMINI_TEST_HEARTBEAT_FILE
    else process.env.GEMINI_TEST_HEARTBEAT_FILE = originalHeartbeatFile
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})
