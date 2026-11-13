import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { runAcpImageTask } from "./acp.js"

const CLI_PROMPT = "Complete the task provided on standard input. Treat it as the user's request."
const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_ERROR_BYTES = 4 * 1024

export const GEMINI_MODELS = [
  { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", subagentProvider: "gemini" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", subagentProvider: "gemini-pro" },
]

export function validateModel(model) {
  const supportedModel = GEMINI_MODELS.find((candidate) => candidate.id === model)
  if (!supportedModel) throw new Error(`Unsupported Gemini CLI model ID: ${model}`)
  return supportedModel.id
}

export function parseGeminiOutput(stdout, stderr = "") {
  let result
  try {
    result = JSON.parse(stdout)
  } catch {
    throw new Error(`Gemini CLI returned invalid JSON.${stderr.trim() ? ` ${stderr.trim().slice(-MAX_ERROR_BYTES)}` : ""}`)
  }
  if (result?.error) {
    const message = typeof result.error === "string" ? result.error : result.error.message
    throw new Error(message || "Gemini CLI reported an error.")
  }
  if (typeof result?.response !== "string") {
    throw new Error("Gemini CLI JSON output did not contain a response string.")
  }
  return result.response
}

function readOutput(handle, stream, maxBytes) {
  const output = handle.collected[stream]?.readFrom(0)
  if (!output) return ""
  if (output.lossy || output.nextOffset > maxBytes) {
    throw new Error(`Gemini CLI ${stream} exceeded the ${maxBytes} byte output limit.`)
  }
  return output.text
}

function abortError(signal, timeoutSignal) {
  if (signal?.aborted) return new Error("Gemini task was cancelled.")
  if (timeoutSignal.aborted) return new Error(`Gemini CLI did not finish within ${DEFAULT_TIMEOUT_MS} ms.`)
}

function isInside(directory, parent) {
  const pathFromParent = relative(parent, directory)
  return pathFromParent === "" || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent))
}

async function runLookup(subprocess, argv, cwd, signal) {
  const handle = subprocess.spawn({
    argv,
    cwd,
    stdio: { stdin: "ignore", stdout: { maxBytes: 4096 }, stderr: { maxBytes: MAX_ERROR_BYTES } },
    graceMs: 3000,
    signal,
  })
  let outcome
  try {
    outcome = await handle.done
  } finally {
    await handle.waitForExit()
  }
  return {
    outcome,
    stdout: readOutput(handle, "stdout", 4096),
    stderr: readOutput(handle, "stderr", MAX_ERROR_BYTES),
  }
}

async function resolveWindowsGemini(subprocess, cwd, signal) {
  const where = await subprocess.resolveExecutable("where.exe", undefined, signal)
  const lookup = await runLookup(subprocess, [where, "gemini.cmd"], cwd, signal)
  const projectDirectory = resolve(cwd)
  const shim = lookup.stdout.split(/\r?\n/).map((path) => path.trim()).find((path) => path && !isInside(dirname(path), projectDirectory))
  if (lookup.outcome.exitCode !== 0 || !shim) {
    throw new Error(`Gemini CLI npm shim was not found outside the project directory.${lookup.stderr.trim() ? ` ${lookup.stderr.trim()}` : ""}`)
  }
  const node = await subprocess.resolveExecutable("node.exe", undefined, signal)
  const entryPoint = join(dirname(shim), "node_modules", "@google", "gemini-cli", "bundle", "gemini.js")
  return { command: node, args: [entryPoint] }
}

export async function runGeminiImageTask({ subprocess, task, images, cwd, model, signal }) {
  if (typeof task !== "string" || task.trim() === "") throw new Error("Task must not be empty.")
  if (!Array.isArray(images) || images.length === 0 || images.some((image) =>
    image?.type !== "image" || typeof image.data !== "string" || !image.data || typeof image.mimeType !== "string" || !image.mimeType)) {
    throw new Error("Images must be ACP image content blocks.")
  }
  const selectedModel = validateModel(model)
  if (signal?.aborted) throw new Error("Gemini task was cancelled.")
  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const executionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  try {
    const platform = (await subprocess.terminalEnvironment(executionSignal)).platform
    const command = platform === "windows"
      ? await resolveWindowsGemini(subprocess, cwd, executionSignal)
      : { command: await subprocess.resolveExecutable("gemini", undefined, executionSignal), args: [] }
    if (executionSignal.aborted) throw abortError(signal, timeoutSignal)
    const handle = subprocess.spawn({
      argv: [command.command, ...command.args, "--acp", "--approval-mode=yolo", "--model", selectedModel],
      cwd,
      stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      graceMs: 3000,
      signal: executionSignal,
    })
    const response = await runAcpImageTask({ handle, task, images, cwd, signal: executionSignal })
    const aborted = abortError(signal, timeoutSignal)
    if (aborted) throw aborted
    return response
  } catch (error) {
    const aborted = abortError(signal, timeoutSignal)
    if (!aborted) throw error
    if (error instanceof Error && error.message !== aborted.message && error.message !== "Gemini task was cancelled.") {
      aborted.message += ` ${error.message}`
    }
    throw aborted
  }
}

export async function runGeminiTask({ subprocess, task, cwd, model, signal }) {
  if (typeof task !== "string" || task.trim() === "") throw new Error("Task must not be empty.")
  const selectedModel = validateModel(model)
  if (signal?.aborted) throw new Error("Gemini task was cancelled.")

  const timeoutSignal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  const executionSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  try {
    const platform = (await subprocess.terminalEnvironment(executionSignal)).platform
    const command = platform === "windows"
      ? await resolveWindowsGemini(subprocess, cwd, executionSignal)
      : { command: await subprocess.resolveExecutable("gemini", undefined, executionSignal), args: [] }
    const geminiArgs = ["--prompt", CLI_PROMPT, "--output-format", "json", "--approval-mode=yolo", "--model", selectedModel]
    const argv = [command.command, ...command.args, ...geminiArgs]

    const handle = subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: { data: task },
        stdout: { maxBytes: MAX_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_ERROR_BYTES },
      },
      graceMs: 3000,
      signal: executionSignal,
    })
    let outcome
    try {
      outcome = await handle.done
    } finally {
      await handle.waitForExit()
    }
    const aborted = abortError(signal, timeoutSignal)
    if (aborted) throw aborted
    const stderr = readOutput(handle, "stderr", MAX_ERROR_BYTES)
    if (outcome.exitCode !== 0) {
      throw new Error(`Gemini CLI exited with code ${outcome.exitCode}.${stderr.trim() ? ` ${stderr.trim()}` : ""}`)
    }
    return parseGeminiOutput(readOutput(handle, "stdout", MAX_OUTPUT_BYTES), stderr)
  } catch (error) {
    const aborted = abortError(signal, timeoutSignal)
    if (aborted) throw aborted
    throw error
  }
}
