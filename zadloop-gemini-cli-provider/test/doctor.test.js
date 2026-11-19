import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { formatReport, runDoctor } from "../src/doctor.js"

const doctorPath = fileURLToPath(new URL("../src/doctor.js", import.meta.url))

function fakeCliSource(scenario, logPath) {
  return `
const fs = require("node:fs")
const readline = require("node:readline")
const scenario = ${JSON.stringify(scenario)}
const logPath = ${JSON.stringify(logPath)}
const log = (entry) => fs.appendFileSync(logPath, JSON.stringify(entry) + "\\n")
const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
const args = process.argv.slice(2)
if (args.includes("--version")) {
  log({ phase: "version", args })
  if (scenario === "bad-version") process.stdout.write("version 0.68.0\\n")
  else process.stdout.write("0.68.0\\n")
  process.stderr.write("raw version diagnostic password=hunter2\\n")
  process.exit(0)
}
if (!args.includes("--acp")) process.exit(2)
log({ phase: "acp", args })
fs.writeFileSync(logPath + ".pid", String(process.pid))
process.stderr.write("raw acp diagnostic token=secret-token\\n")
if (scenario === "exit-before-handshake") process.exit(0)
if (scenario === "malformed-json") process.stdout.write("not-json\\n")
const lines = readline.createInterface({ input: process.stdin })
lines.on("line", (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  log({ phase: "acp-request", method: message.method, id: message.id })
  if (scenario === "timeout" || scenario === "malformed-json") return
  if (scenario === "handshake-error") {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -1, message: "raw handshake diagnostic password=hunter2" } })
    return
  }
  if (scenario === "bad-handshake") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 2 } })
    return
  }
  const image = scenario === "supported" ? true : scenario === "unknown-type" ? "yes" : false
  const promptCapabilities = scenario === "no-capabilities" ? undefined : { image }
  const agentCapabilities = scenario === "no-capabilities" ? {} : { promptCapabilities }
  send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1, agentCapabilities } })
})
setInterval(() => {}, 1000)
`
}

async function createFakeCli(directory, scenario, logPath) {
  if (process.platform === "win32") {
    const bundle = join(directory, "node_modules", "@google", "gemini-cli", "bundle")
    await mkdir(bundle, { recursive: true })
    await writeFile(join(directory, "gemini.cmd"), "@echo off\r\n")
    await writeFile(join(bundle, "gemini.js"), fakeCliSource(scenario, logPath))
    return
  }
  await mkdir(directory, { recursive: true })
  const executable = join(directory, "gemini")
  await writeFile(executable, `#!/usr/bin/env node\n${fakeCliSource(scenario, logPath)}`)
  await chmod(executable, 0o755)
}

function envWithPath(directories) {
  return { ...process.env, PATH: [...directories, process.env.PATH ?? ""].join(delimiter) }
}

async function fixture(t, scenario) {
  const root = await mkdtemp(join(tmpdir(), "gemini-doctor-"))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))
  const bin = join(root, "bin")
  const project = join(root, "project")
  const log = join(root, "cli.log")
  await mkdir(project, { recursive: true })
  await createFakeCli(bin, scenario, log)
  return { root, bin, project, log, env: envWithPath([bin]) }
}

async function readLog(file) {
  try {
    const text = await readFile(file, "utf8")
    return text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

async function waitForPidFile(file) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      return Number(await readFile(file, "utf8"))
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      await new Promise((resolveWait) => setTimeout(resolveWait, 25))
    }
  }
  assert.fail("the fake CLI never recorded its process ID")
}

async function waitUntilGone(pid) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (!isRunning(pid)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  assert.fail(`the fake CLI process ${pid} was still running after cleanup`)
}

function runCli(env, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [doctorPath], { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.once("close", (code) => resolveRun({ code, stdout, stderr }))
  })
}

test("doctor reports a supported image capability and sends only initialize", async (t) => {
  const fixturePaths = await fixture(t, "supported")
  const report = await runDoctor({ cwd: fixturePaths.project, env: fixturePaths.env })
  assert.equal(report.ok, true)
  assert.equal(report.version, "0.68.0")
  assert.equal(report.acp, "ok")
  assert.equal(report.image, "supported")
  const entries = await readLog(fixturePaths.log)
  assert.deepEqual(entries.filter((entry) => entry.phase === "version").map((entry) => entry.args), [["--version"]])
  assert.deepEqual(entries.filter((entry) => entry.phase === "acp").map((entry) => entry.args), [["--acp"]])
  assert.deepEqual(entries.filter((entry) => entry.phase === "acp-request").map((entry) => [entry.id, entry.method]), [[1, "initialize"]])
})

test("doctor reports an explicitly unsupported image capability", async (t) => {
  const fixturePaths = await fixture(t, "unsupported")
  const report = await runDoctor({ cwd: fixturePaths.project, env: fixturePaths.env })
  assert.equal(report.ok, true)
  assert.equal(report.acp, "ok")
  assert.equal(report.image, "unsupported")
  assert.match(formatReport(report), /ACP image input: unsupported/)
})

test("doctor treats an omitted image capability as unsupported", async (t) => {
  const fixturePaths = await fixture(t, "no-capabilities")
  const report = await runDoctor({ cwd: fixturePaths.project, env: fixturePaths.env })
  assert.equal(report.ok, true)
  assert.equal(report.image, "unsupported")
})

test("doctor fails when the advertised image capability has an invalid type", async (t) => {
  const fixturePaths = await fixture(t, "unknown-type")
  const report = await runDoctor({ cwd: fixturePaths.project, env: fixturePaths.env })
  assert.equal(report.ok, false)
  assert.equal(report.acp, "failed")
  assert.equal(report.image, "unknown")
  assert.match(report.errors.join("\n"), /invalid image capability/)
})

test("doctor fails on a version output that is not only a semantic version token", async (t) => {
  const fixturePaths = await fixture(t, "bad-version")
  const report = await runDoctor({ cwd: fixturePaths.project, env: fixturePaths.env })
  assert.equal(report.ok, false)
  assert.equal(report.version, undefined)
  assert.equal(report.acp, "skipped")
  assert.equal(report.image, "unknown")
  assert.match(report.errors.join("\n"), /plain semantic version/)
  assert.doesNotMatch(formatReport(report), /version 0\.68\.0/)
})

test("doctor fails when the ACP process starts but does not handshake", async (t) => {
  const fixturePaths = await fixture(t, "exit-before-handshake")
  const report = await runDoctor({ cwd: fixturePaths.project, env: fixturePaths.env })
  assert.equal(report.ok, false)
  assert.equal(report.acp, "failed")
  assert.equal(report.image, "unknown")
  assert.match(report.errors.join("\n"), /exited before answering initialize/)
})

test("doctor bounds a stalled ACP probe and confirms process cleanup", async (t) => {
  const fixturePaths = await fixture(t, "timeout")
  const started = Date.now()
  const report = await runDoctor({ cwd: fixturePaths.project, env: fixturePaths.env, probeTimeoutMs: 300 })
  assert.equal(report.ok, false)
  assert.match(report.errors.join("\n"), /did not answer initialize in time/)
  assert.ok(Date.now() - started < 15_000)
  const pid = await waitForPidFile(`${fixturePaths.log}.pid`)
  await waitUntilGone(pid)
})

test("doctor does not confirm cleanup when the kill request fails and the root exits later", async (t) => {
  const fixturePaths = await fixture(t, "supported")
  const report = await runDoctor({
    cwd: fixturePaths.project,
    env: fixturePaths.env,
    terminate: (child) => {
      setTimeout(() => {
        try { child.kill() } catch {}
      }, 100)
      return false
    },
  })
  assert.equal(report.ok, false)
  assert.equal(report.acp, "ok")
  assert.match(report.errors.join("\n"), /termination could not be confirmed/)
})

test("doctor reports unconfirmed cleanup without keeping the root process alive", async (t) => {
  const fixturePaths = await fixture(t, "supported")
  const report = await runDoctor({
    cwd: fixturePaths.project,
    env: fixturePaths.env,
    terminate: async () => false,
  })
  assert.equal(report.ok, false)
  assert.match(report.errors.join("\n"), /termination could not be confirmed/)
  const pid = await waitForPidFile(`${fixturePaths.log}.pid`)
  try {
    process.kill(pid)
  } catch {}
})

test("doctor ignores project-local and npm-injected node_modules/.bin candidates", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "gemini-doctor-path-"))
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))
  const project = join(root, "project")
  const localBin = join(project, "bin")
  const npmBin = join(root, "other", "node_modules", ".bin")
  const trustedBin = join(root, "trusted", "bin")
  await mkdir(project, { recursive: true })
  await createFakeCli(localBin, "bad-version", join(root, "local.log"))
  await createFakeCli(npmBin, "bad-version", join(root, "npm.log"))
  await createFakeCli(trustedBin, "supported", join(root, "trusted.log"))
  const env = envWithPath([localBin, npmBin, trustedBin])
  const report = await runDoctor({ cwd: project, env })
  assert.equal(report.ok, true)
  assert.equal(report.version, "0.68.0")
  assert.deepEqual(await readLog(join(root, "local.log")), [])
  assert.deepEqual(await readLog(join(root, "npm.log")), [])
})

test("doctor exits zero when image input is explicitly unsupported", async (t) => {
  const fixturePaths = await fixture(t, "unsupported")
  const result = await runCli(fixturePaths.env, fixturePaths.project)
  assert.equal(result.code, 0)
  assert.match(result.stdout, /ACP image input: unsupported/)
})

test("doctor exits nonzero on handshake failure without raw diagnostics", async (t) => {
  const fixturePaths = await fixture(t, "handshake-error")
  const result = await runCli(fixturePaths.env, fixturePaths.project)
  assert.equal(result.code, 1)
  assert.match(result.stdout, /ACP initialize: failed/)
  assert.match(result.stdout, /did not complete a compatible initialize/)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /hunter2|secret-token|raw handshake diagnostic/)
})
