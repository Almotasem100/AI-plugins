export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@deepseek-ai/dsh-llm") {
    return { url: new URL("./llm-stub.js", import.meta.url).href, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
