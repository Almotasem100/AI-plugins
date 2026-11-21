# Cost and security findings

## Cost and quota

- One Gemini native subagent classification was requested across the batch. No token count, latency, price, or remaining quota was exposed; these remain unknown.
- Deterministic route checks used Node built-ins and made no model calls.
- Provider docs and error tests expose some quota/rate-limit classifications, but neither provider reports token usage; ACP may obscure token exhaustion as a nominal `end_turn`.
- No comparative cost, latency, model quality, or provider-quota claim is supported by this run.

Least-cost-sufficient strategy: use deterministic checks for exact capabilities and completeness; use one suitable low-cost specialist for bounded judgment; reserve a more expensive root-model call for unresolved consequential synthesis. Avoid duplicate model paraphrases. Capability/permission mismatch blocks a route regardless of model price.

## Security and permission analysis

1. Both provider integrations launch Gemini CLI with `--approval-mode=yolo`; native CLI tools are not governed by the host's per-tool approval UI. The enabled Gemini-native tool loop must be treated as running with the process's user authority.
2. Neither integration currently implements a host-controlled tool bridge. A model transcript containing host tool calls/results is not proof those tools were executed or approved by the host.
3. Neither integration proves an independently enforced read-only boundary. The AI-skills relay's `plan` mode can be affected by CLI settings and is not an OS sandbox; the overlay explicitly recommends OS-enforced isolation where read-only must be guaranteed.
4. Cancellation and process-tree cleanup are tested with fakes. The OpenCode README notes Windows descendant termination is not guaranteed; no real host cleanup was tested here.
5. Capability substitution must preserve scope, exact revision, evidence, limitations, reviewer independence, read-only authority, and result status. A plain “clean” scan summary or auto-fix in the audit run is not an acceptable replacement.

No live host, corporate source, credentials, private session, installed configuration, or external service was accessed.
