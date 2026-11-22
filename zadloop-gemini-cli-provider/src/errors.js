function errorFields(error) {
  if (typeof error === "string") return { type: "", message: error }
  return {
    type: typeof error?.type === "string" ? error.type : "",
    message: typeof error?.message === "string" ? error.message : "",
  }
}

function classified(message, type) {
  const haystack = `${type} ${message}`
  if (/FatalAuthenticationError|ACCOUNT_SIGN_IN_REQUIRED|ACCOUNT_TOKEN_INVALID|\bAUTH\b|authenticat|sign in|log in|login|credential/i.test(haystack)) {
    return "Gemini CLI authentication failed. Sign in by running `gemini` in a terminal, then retry."
  }
  if (/\b(?:context|stream|request|rpc|grpc|network)\s+cancell?ed\b|cancell?ed\s+by\s+(?:upstream|server|remote)/i.test(haystack)) {
    return "Gemini CLI upstream request was interrupted or cancelled."
  }
  if (/FatalCancellationError|cancelled|canceled/i.test(haystack)) {
    return "Gemini CLI reported that the request was cancelled."
  }
  if (/RESOURCE_EXHAUSTED|\bquota\b|rate.?limit|\b429\b/i.test(haystack)) {
    return "Gemini CLI quota or rate limit reached. Wait and retry, or check your Gemini plan."
  }
  if (/FatalConfigError|FatalInputError|FatalSandboxError|invalid (?:config|setting)|config.*(?:error|invalid)/i.test(haystack)) {
    return "Gemini CLI rejected its configuration or input. Check the Gemini CLI setup and working directory."
  }
  return ""
}

export function geminiFailure({ error, message, stderr, exitCode, signal } = {}) {
  const fields = errorFields(error)
  const classification = classified(typeof message === "string" ? message : fields.message, fields.type)
    || classified(stderr, "")
  if (classification) return new Error(classification)
  if (typeof exitCode === "number" && exitCode !== 0) return new Error(`Gemini CLI exited with code ${exitCode}.`)
  if (typeof signal === "string") return new Error("Gemini CLI was terminated before reporting a result.")
  return new Error("Gemini CLI reported an error.")
}

export function geminiProcessFailure({ exitCode, stderr } = {}) {
  const classification = classified(stderr, "")
  if (classification) return new Error(classification)
  if (typeof exitCode === "number" && exitCode !== 0) return new Error(`Gemini CLI exited with code ${exitCode}.`)
  return new Error("Gemini CLI ended before reporting a result.")
}

export function geminiStartupFailure() {
  return new Error("Gemini CLI could not start. Check that it is installed and authenticated.")
}

export function geminiProtocolFailure() {
  return new Error("Gemini CLI returned invalid protocol output.")
}

export function geminiOutputLimitFailure(stream, maxBytes) {
  return new Error(`Gemini CLI ${stream} exceeded the ${maxBytes} byte output limit.`)
}
