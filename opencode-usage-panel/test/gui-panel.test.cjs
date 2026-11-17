'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.disabled = false; this.ownText = ''; this.attributes = {} }
  set textContent(value) { this.ownText = value; this.children = [] }
  get textContent() { return this.ownText + this.children.map(child => child.textContent).join('') }
  setAttribute(name, value) { this.attributes[name] = value }
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.ownText = ''; this.children = children }
  addEventListener(name, handler) { this[name] = handler }
  matches(selector) { return selector === ':popover-open' && this.open === true }
  showPopover() { this.open = true; this.toggle?.() }
  hidePopover() { this.open = false; this.toggle?.() }
  getBoundingClientRect() { return this.bounds || { top: 10, bottom: 40, right: 500, width: 318 } }
}
function harness(request, timers = { setTimeout, clearTimeout }) {
  let slot, cleanup, contract, effect, calls = 0
  let rootCleanup
  const registry = {}
  const document = { createElement: tag => new Element(tag), createTextNode: text => { const node = new Element('#text'); node.textContent = text; return node } }
  const sandbox = {
    module: { exports: {} }, document, window: { innerWidth: 1000, innerHeight: 800, addEventListener() {}, removeEventListener() {} }, ...timers,
    require(name) {
      if (name === '@opencode/plugin/gui') return { Plugin: { define: value => value }, Slot: registry }
      if (name === '@opencode/plugin/rpc') return { Rpc: { define: value => value } }
      if (name === 'solid-js') return {
        createComponent: (component, props) => component(props),
        createEffect: fn => { effect = fn; fn() },
        createRoot: fn => fn(() => rootCleanup?.()),
        onCleanup: fn => { if (!cleanup) cleanup = fn; else rootCleanup = fn },
      }
      throw Error(name)
    },
  }
  const code = fs.readFileSync(path.join(__dirname, '../gui-experimental.cjs'), 'utf8')
  vm.runInNewContext(code, sandbox)
  sandbox.module.exports.default.setup({
    add(type, entry) { assert.equal(type, registry); slot = entry },
    ui: { IconButton: props => { const button = new Element('button'); button.setAttribute('aria-label', props.label); button.click = () => props.onClick({ currentTarget: button }); return button } },
  })
  const location = { type: 'project', id: 'test-location' }
  const session = { location, server: { client: { rpc: definition => {
    contract = definition
    return { refresh: (input, options) => {
      assert.equal(definition.methods.refresh.input.type, 'null')
      assert.equal(input, null)
      assert.equal(options.location, location)
      calls++
      return request()
    } }
  } } } }
  const input = { session: { ...session, key: 'session-1' }, active: true }
  const header = slot.render(input)
  return { slot, header, input, effect: () => effect(), open: () => { header.children[0].click(); return header.children[1].children[0] }, get calls() { return calls }, get contract() { return contract }, cleanup: () => cleanup() }
}
const flush = () => new Promise(resolve => setImmediate(resolve))
const sample = {
  claude: { status: 'ok', fiveHour: { percent: 15, resetsAt: null }, weekly: { percent: 45, resetsAt: '2030-01-01T00:00:00.000Z' } },
  chatgpt: { status: 'not-signed-in' },
}

test('opening and refreshing load usage without fetching on registration', async () => {
  const host = harness(() => Promise.resolve(sample))
  assert.equal(host.calls, 0)
  assert.equal(host.slot.at, 'session.header')
  assert.equal(host.header.children[0].attributes['aria-label'], 'Subscription usage')
  const view = host.open()
  assert.equal(view.style.maxHeight, 'min(300px, calc(100vh - 100px))')
  assert.equal(view.style.overflowY, 'auto')
  assert.match(view.textContent, /Loading/)
  assert.equal(view.children[1].attributes['aria-disabled'], 'true')
  view.children[1].click()
  await flush()
  assert.equal(host.calls, 1)
  assert.match(view.textContent, /Claude.*5-hour: 15% used.*Weekly: 45% used.*ChatGPT.*Not signed in/)
  view.children[1].click()
  await flush()
  assert.equal(host.calls, 2)
  host.cleanup()
})

test('session changes close the popup and reopening fetches again', async () => {
  const host = harness(() => Promise.resolve(sample))
  host.open()
  await flush()
  assert.equal(host.calls, 1)
  host.input.session = { ...host.input.session, key: 'session-2' }
  host.effect()
  assert.equal(host.header.children[1].open, false)
  assert.equal(host.header.children[0].attributes['aria-expanded'], 'false')
  host.open()
  await flush()
  assert.equal(host.calls, 2)
  host.cleanup()
})

test('popup stays within the viewport near the left and bottom edges', async () => {
  const host = harness(() => Promise.resolve(sample))
  host.header.children[0].bounds = { top: 750, bottom: 780, right: 40 }
  host.open()
  const popup = host.header.children[1]
  assert.equal(popup.style.right, '674px')
  assert.equal(popup.style.top, 'auto')
  assert.equal(popup.style.bottom, '54px')
  await flush()
  host.cleanup()
})

test('closing before the request starts does not fetch usage', async () => {
  const host = harness(() => Promise.resolve(sample))
  host.open()
  host.header.children[0].click()
  await flush()
  assert.equal(host.calls, 0)
  host.cleanup()
})

test('GUI and server use the same portable RPC schema', async () => {
  const host = harness(() => Promise.resolve(sample))
  host.open()
  await flush()
  const source = fs.readFileSync(path.join(__dirname, '../src/rpc.js'), 'utf8')
    .replace("import { Rpc } from '@opencode/plugin/rpc'", 'const Rpc = { define: value => value }')
    .replace('export const Usage =', 'module.exports =')
  const server = { module: { exports: {} } }
  vm.runInNewContext(source, server)
  assert.deepEqual(JSON.parse(JSON.stringify(host.contract)), JSON.parse(JSON.stringify(server.module.exports)))
  host.cleanup()
})

test('RPC errors do not expose raw error text and allow retry', async () => {
  let count = 0
  const host = harness(() => ++count === 1 ? Promise.reject(new Error('secret')) : Promise.resolve(sample))
  const view = host.open()
  await flush()
  assert.match(view.textContent, /Unable to load usage/)
  assert.doesNotMatch(view.textContent, /secret/)
  view.children[1].click()
  await flush()
  assert.match(view.textContent, /15% used/)
  host.cleanup()
})

test('timeout recovers and late results cannot overwrite timeout', async () => {
  let trigger, resolveRequest
  const host = harness(() => new Promise(resolve => { resolveRequest = resolve }), {
    setTimeout: fn => { trigger = fn; return 1 }, clearTimeout() {},
  })
  const view = host.open()
  await flush()
  trigger()
  await flush()
  assert.match(view.textContent, /timed out/)
  assert.equal(view.children[1].disabled, false)
  resolveRequest(sample)
  await flush()
  assert.match(view.textContent, /timed out/)
  host.cleanup()
})

test('malformed provider data is not rendered as trusted text', async () => {
  const host = harness(() => Promise.resolve({ claude: { status: 'ok', fiveHour: { percent: '<secret>', resetsAt: null } }, chatgpt: { status: 'unexpected-format' } }))
  const view = host.open()
  await flush()
  assert.doesNotMatch(view.textContent, /secret/)
  assert.match(view.textContent, /5-hour: Unavailable.*Weekly: Unavailable.*Usage data unavailable/)
  host.cleanup()
})
