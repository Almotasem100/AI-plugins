import { StringDecoder } from "node:string_decoder"
import { geminiOutputLimitFailure, geminiProtocolFailure } from "./errors.js"

/**
 * Yield one parsed JSON value per non-empty line from a byte stream. UTF-8 is
 * decoded across chunk boundaries, so a split code point is never replaced.
 * The cumulative byte limit is checked before decoding; an unterminated final
 * line is a protocol error rather than a silently dropped message.
 */
export async function* readJsonLines(stream, { maxBytes, label = "stdout" }) {
  if (!stream) throw geminiProtocolFailure()
  const decoder = new StringDecoder("utf8")
  let buffer = ""
  let bytes = 0
  for await (const chunk of stream) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += data.length
    if (bytes > maxBytes) throw geminiOutputLimitFailure(label, maxBytes)
    buffer += decoder.write(data)
    let newline
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (!line.trim()) continue
      try {
        yield JSON.parse(line)
      } catch {
        throw geminiProtocolFailure()
      }
    }
  }
  buffer += decoder.end()
  if (buffer.trim()) throw geminiProtocolFailure()
}
