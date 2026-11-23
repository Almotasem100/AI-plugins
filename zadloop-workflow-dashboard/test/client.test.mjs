import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8")

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function makeSnapshot(overrides = {}) {
  return {
    readOnly: true,
    additionalModelCalls: 0,
    collectedAt: "2026-11-23T00:00:00.000Z",
    sessionId: "sess-1",
    workItem: {
      sourcePath: "active-work/scratchpad.md",
      updatedAt: "2026-11-23T00:00:00.000Z",
      stale: false,
      liveActivity: "Unknown",
      workflowKind: "Full Feature",
      objective: "Ship read-only sidebar",
      activeItem: "CB-202",
      stage: "Review",
      stageStatus: "Started (last reported)",
      hasOpenBlockers: true,
      taskStatus: "Blocked",
      reposState: "AI-plugins feat/stage2 @ abc1234",
      completed: ["Adapter hardened"],
      decisions: ["Pilot host is ZadLoop"],
      blockers: ["Awaiting ChatGPT review"],
      verificationNotes: ["All offline tests pass"],
      nextAction: ["Address review feedback"],
    },
    participant: {
      participant: "session",
      configuredLane: "gemini/gemini-3.8-flash",
      executedModel: "gemini/gemini-3.8-flash",
      modelVerified: true,
      modelEvidenceSource: "assistant/message@sess-1#5",
    },
    verification: {
      sourcePath: "test-results/junit.xml",
      status: "Passed",
      counts: { passed: 7, failed: 0, skipped: 0, blocked: 0 },
      testedRevision: "abc1234",
    },
    ...overrides,
  }
}

function mountClient(fetchImpl) {
  const hooks = []
  const timers = new Map()
  const intervals = new Set()
  let hookIndex = 0
  let nextTimerId = 1
  let tabRegistration
  let slotRegistration
  const disposers = []

  const React = {
    Fragment: Symbol("Fragment"),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children }
    },
    useSyncExternalStore() {},
    useState(initial) {
      const idx = hookIndex++
      if (!(idx in hooks)) hooks[idx] = initial
      return [hooks[idx], (value) => { hooks[idx] = value }]
    },
    useRef(initial) {
      const idx = hookIndex++
      return (hooks[idx] ||= { current: initial })
    },
    useEffect(effect, deps) {
      const idx = hookIndex++
      const prev = hooks[idx]
      if (!prev || !deps || deps.some((v, i) => v !== prev.deps[i])) {
        prev?.cleanup?.()
        hooks[idx] = { deps, cleanup: effect() }
      }
    },
  }

  let pluginFactory
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(mod) {
          pluginFactory = mod.factory
        },
      },
    },
    fetch: fetchImpl,
    AbortController,
    Date,
    encodeURIComponent,
    setTimeout(fn) {
      const id = nextTimerId++
      timers.set(id, fn)
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    setInterval() {
      const id = nextTimerId++
      intervals.add(id)
      return id
    },
    clearInterval(id) {
      intervals.delete(id)
    },
  }
  vm.runInNewContext(source, sandbox)

  const plugin = pluginFactory((name) => {
    if (name === "react") return React
    throw new Error(`Unexpected require: ${name}`)
  })

  const dictionaries = new Map()
  const state = { localeDisposed: false, tabDisposed: false, slotDisposed: false }
  const ctx = {
    locale: {
      subscribe: () => () => {},
      getSnapshot: () => "en",
      register(ns, lang, dict) {
        dictionaries.set(`${ns}:${lang}`, dict)
        return () => { state.localeDisposed = true }
      },
      bind(ns) {
        return (key) => dictionaries.get(`${ns}:en`)?.[key] ?? key
      },
    },
    sidebarRight: {},
    sidebarRightTabs: {
      register(def) {
        tabRegistration = def
        return () => { state.tabDisposed = true }
      },
    },
    slots: {
      inject(name, fn) {
        return fn()
      },
      register(def, Component) {
        slotRegistration = { def, Component }
        return () => { state.slotDisposed = true }
      },
    },
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === "function") disposers.push(dispose)
    },
  }

  plugin.apply(ctx)

  function render(sessionId) {
    hookIndex = 0
    const injected = slotRegistration.def.inject(sessionId)
    return slotRegistration.Component(injected)
  }

  function unmount() {
    for (const h of hooks) {
      if (h && typeof h.cleanup === "function") h.cleanup()
    }
  }

  function disablePlugin() {
    for (const dispose of disposers) dispose()
  }

  return { render, unmount, disablePlugin, timers, intervals, get tabRegistration() { return tabRegistration }, get slotRegistration() { return slotRegistration }, state }
}

function collectText(node) {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(collectText).join(" ")
  if (typeof node.type === "function") return collectText(node.type(node.props))
  return (node.children || []).map(collectText).join(" ")
}

function findNode(node, predicate) {
  if (!node || typeof node !== "object") return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findNode(item, predicate)
      if (found) return found
    }
    return null
  }
  if (typeof node.type === "function") return findNode(node.type(node.props), predicate)
  if (predicate(node)) return node
  return findNode(node.children, predicate)
}

test("registers right-sidebar tab, renders verified evidence with zero polling, and disposes cleanly", async () => {
  const requests = []
  const app = mountClient(async (url) => {
    requests.push(url)
    return { ok: true, json: async () => makeSnapshot() }
  })

  assert.equal(app.tabRegistration.kind, "workflow-dashboard")
  assert.equal(app.tabRegistration.priority, "extension")
  assert.equal(app.tabRegistration.title(), "Workflow")
  assert.equal(app.slotRegistration.def.name, "sidebar.right.pane.tab")

  app.render("sess-1")
  await new Promise((r) => setImmediate(r))
  const tree = app.render("sess-1")
  const text = collectText(tree)

  assert.deepEqual(requests, ["/api/workflow-dashboard?sessionId=sess-1"])
  assert.equal(app.intervals.size, 0)
  assert.equal(app.timers.size, 0)
  assert.match(text, /Read-only · 0 AI calls/)
  assert.match(text, /CB-202/)
  assert.match(text, /Full Feature/)
  assert.match(text, /Blocked/)
  assert.match(text, /Awaiting ChatGPT review/)
  assert.match(text, /gemini\/gemini-3\.8-flash/)
  assert.match(text, /assistant\/message@sess-1#5/)
  assert.match(text, /7 passed/)

  app.unmount()
  app.disablePlugin()
  assert.equal(app.state.localeDisposed, true)
  assert.equal(app.state.tabDisposed, true)
  assert.equal(app.state.slotDisposed, true)
})

test("switching active sessions aborts stale request, clears prior state, and ignores late completion", async () => {
  const first = deferred()
  const second = deferred()
  const signals = []
  let call = 0
  const app = mountClient((url, init) => {
    signals.push({ url, signal: init.signal })
    call += 1
    return call === 1 ? first.promise : second.promise
  })

  app.render("sess-1")
  assert.equal(signals[0].url, "/api/workflow-dashboard?sessionId=sess-1")
  assert.equal(signals[0].signal.aborted, false)

  // Switch to sess-2 before sess-1 resolves
  app.render("sess-2")
  assert.equal(signals[0].signal.aborted, true)
  assert.equal(signals[1].url, "/api/workflow-dashboard?sessionId=sess-2")

  // Late resolution of sess-1 must be ignored
  first.resolve({ ok: true, json: async () => makeSnapshot({ sessionId: "sess-1" }) })
  second.resolve({
    ok: true,
    json: async () => makeSnapshot({
      sessionId: "sess-2",
      workItem: { ...makeSnapshot().workItem, activeItem: "CB-999", blockers: [], hasOpenBlockers: false, taskStatus: "Started (last reported)" },
      participant: { participant: "session", configuredLane: "default", executedModel: "forged-model", modelVerified: false, modelEvidenceSource: "forged" },
    }),
  })
  await new Promise((r) => setImmediate(r))
  const text = collectText(app.render("sess-2"))
  assert.match(text, /CB-999/)
  assert.doesNotMatch(text, /CB-202/)
  // Unverified executedModel must never be displayed
  assert.doesNotMatch(text, /forged-model/)
  assert.match(text, /Unknown/)
})

test("manual refresh retains prior snapshot as Stale on failure and unmount cancels pending fetch", async () => {
  let attempt = 0
  let pendingSignal
  const pending = deferred()
  const app = mountClient(async (_url, init) => {
    attempt += 1
    if (attempt === 1) return { ok: true, json: async () => makeSnapshot() }
    if (attempt === 2) return { ok: false, status: 503, json: async () => ({ error: "unavailable" }) }
    pendingSignal = init.signal
    return pending.promise
  })

  app.render("sess-1")
  await new Promise((r) => setImmediate(r))
  let tree = app.render("sess-1")
  const refreshBtn = findNode(tree, (n) => n.type === "button" && n.props.className === "wf-dash-refresh")
  assert.ok(refreshBtn)

  // Failed refresh keeps prior data and marks Stale
  refreshBtn.props.onClick()
  await new Promise((r) => setImmediate(r))
  tree = app.render("sess-1")
  const text = collectText(tree)
  assert.match(text, /CB-202/)
  assert.match(text, /Stale/)

  // Start another refresh then close/unmount -> aborts fetch and clears timers
  const refreshBtn2 = findNode(tree, (n) => n.type === "button" && n.props.className === "wf-dash-refresh")
  refreshBtn2.props.onClick()
  assert.equal(pendingSignal.aborted, false)
  app.unmount()
  assert.equal(pendingSignal.aborted, true)
  assert.equal(app.timers.size, 0)
})

test("rejects payloads that claim non-zero additionalModelCalls or readOnly !== true", async () => {
  const app = mountClient(async () => ({
    ok: true,
    json: async () => makeSnapshot({ additionalModelCalls: 1 }),
  }))

  app.render("sess-1")
  await new Promise((r) => setImmediate(r))
  const text = collectText(app.render("sess-1"))
  assert.match(text, /Could not load workflow evidence/)
  assert.doesNotMatch(text, /CB-202/)
})
