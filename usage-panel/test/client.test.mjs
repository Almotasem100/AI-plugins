import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function panel(fetch) {
  const hooks = [];
  const timers = new Map();
  let index = 0;
  let nextTimer = 0;
  let Component;
  const React = {
    Fragment: Symbol('fragment'),
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore() {},
    useState(initial) {
      const slot = index++;
      if (!(slot in hooks)) hooks[slot] = initial;
      return [hooks[slot], value => { hooks[slot] = value; }];
    },
    useRef(initial) {
      const slot = index++;
      return hooks[slot] ||= { current: initial };
    },
    useEffect(effect, deps) {
      const slot = index++;
      const previous = hooks[slot];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) {
        previous?.cleanup?.();
        hooks[slot] = { deps, cleanup: effect() };
      }
    },
  };
  const document = { body: {}, addEventListener() {}, removeEventListener() {} };
  const window = { innerWidth: 1000, addEventListener() {}, removeEventListener() {}, __ModuleLoader__: { load(module) {
    const plugin = module.factory(name => name === 'react' ? React : { createPortal: element => element });
    plugin.apply({ locale: { subscribe() {}, getSnapshot() {}, bind: () => key => key, register() {} },
      effect: fn => fn(), slots: { inject: (_, fn) => fn(), register: (_, component) => { Component = component; } } });
  } } };
  vm.runInNewContext(source, { window, document, fetch, AbortController,
    setTimeout: fn => { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout: id => timers.delete(id),
  });
  function render() { index = 0; return Component(); }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined;
    if (predicate(node)) return node;
    for (const child of node.children || []) {
      const found = find(child, predicate);
      if (found) return found;
    }
  }
  return {
    render,
    button: className => find(render(), node => node.props.className === className),
    find: predicate => find(render(), predicate),
    timeout() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()); },
    timerCount: () => timers.size,
  };
}

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

for (const stage of ['fetch', 'body']) {
  test(`stalled ${stage} times out, permits retry and ignores late completion`, async () => {
    const stalled = deferred();
    const requests = [];
    const ui = panel((url, options) => {
      requests.push(options);
      if (requests.length > 1) return Promise.resolve({ ok: true, json: async () => ({ claude: { status: 'new' } }) });
      return stage === 'fetch' ? stalled.promise : Promise.resolve({ ok: true, json: () => stalled.promise });
    });
    ui.button('usage-panel-trigger').props.onClick();
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(ui.button('usage-panel-refresh').props.disabled, true);
    ui.timeout();
    await settle();
    assert.equal(requests[0].signal.aborted, true);
    assert.ok(ui.find(node => node.props.role === 'alert'));
    ui.button('usage-panel-refresh').props.onClick();
    await settle();
    assert.equal(requests.length, 2);
    assert.equal(ui.find(node => node.props.name === 'Claude').props.data.status, 'new');
    stalled.resolve(stage === 'fetch' ? { ok: true, json: async () => ({ claude: { status: 'old' } }) } : { claude: { status: 'old' } });
    await settle();
    assert.equal(ui.find(node => node.props.name === 'Claude').props.data.status, 'new');
    assert.equal(ui.timerCount(), 0);
    ui.unmount();
  });
}

test('a failed request shows an error and a manual retry succeeds without polling', async () => {
  let calls = 0;
  const ui = panel(() => {
    calls++;
    return calls === 1 ? Promise.reject(new Error('network')) : Promise.resolve({ ok: true, json: async () => ({}) });
  });
  ui.button('usage-panel-trigger').props.onClick();
  await settle();
  assert.ok(ui.find(node => node.props.role === 'alert'));
  ui.button('usage-panel-refresh').props.onClick();
  await settle();
  assert.equal(ui.find(node => node.props.role === 'alert'), undefined);
  assert.equal(ui.button('usage-panel-refresh').props.disabled, false);
  assert.equal(ui.timerCount(), 0);
  ui.timeout();
  assert.equal(calls, 2);
  ui.unmount();
});

test('unmount aborts a stalled request and removes its deadline', async () => {
  const stalled = deferred();
  let signal;
  const ui = panel((url, options) => { signal = options.signal; return stalled.promise; });
  ui.button('usage-panel-trigger').props.onClick();
  ui.unmount();
  await settle();
  assert.equal(signal.aborted, true);
  assert.equal(ui.timerCount(), 0);
  stalled.resolve({ ok: true, json: async () => ({}) });
  await settle();
});
