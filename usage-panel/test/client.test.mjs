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
const okSnapshot = () => ({
  claude: {
    status: 'ok',
    fiveHour: { percent: 24, resetsAt: '2026-11-19T10:00:00.000Z' },
    weekly: { percent: 80, resetsAt: null },
  },
  chatgpt: {
    status: 'ok',
    fiveHour: { percent: 8, resetsAt: null },
    weekly: { percent: 65, resetsAt: '2026-11-20T00:00:00.000Z' },
  },
});
const respond = body => Promise.resolve({ ok: true, json: async () => body });

function panel(fetch) {
  const hooks = [];
  const timers = new Map();
  let index = 0;
  let nextTimer = 0;
  let Component;
  const documentListeners = new Map();
  const React = {
    Fragment: Symbol('fragment'),
    createElement(type, props, ...children) {
      const element = {
        type, props: props || {}, children, contains: () => false,
        getBoundingClientRect: () => ({ top: 20, right: 40, width: 16, height: 16 }),
        focus() {},
      };
      if (element.props.ref) element.props.ref.current = element;
      return element;
    },
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
  const document = {
    body: {},
    addEventListener(name, handler) { documentListeners.set(name, handler); },
    removeEventListener(name) { documentListeners.delete(name); },
  };
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
    provider: name => find(render(), node => node.props.name === name),
    documentEvent(name, event) { documentListeners.get(name)?.(event); },
    timeout() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    unmount() { hooks.forEach(hook => hook?.cleanup?.()); },
    timerCount: () => timers.size,
  };
}

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const alert = ui => ui.find(node => node.props.role === 'alert');
const stale = ui => ui.find(node => node.props.className === 'usage-panel-stale');
const checked = ui => ui.find(node => node.type === 'time');
const assertStatus = (data, status) => { assert.equal(data.status, status); assert.deepEqual(Object.keys(data), ['status']); };
const toggle = ui => ui.button('usage-panel-trigger').props.onClick();
const refresh = ui => ui.button('usage-panel-refresh').props.onClick();

test('a valid snapshot renders both providers and a last-checked time', async () => {
  const loaded = deferred();
  const ui = panel(() => loaded.promise);
  toggle(ui);
  ui.render();
  assert.ok(ui.find(node => node.props.role === 'status' && node.props.className === 'usage-panel-message'));
  assert.equal(ui.button('usage-panel-refresh').props.disabled, true);
  loaded.resolve({ ok: true, json: async () => okSnapshot() });
  await settle();
  assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
  assert.equal(ui.provider('ChatGPT').props.data.weekly.percent, 65);
  assert.ok(Number.isFinite(Date.parse(checked(ui).props.dateTime)));
  assert.equal(stale(ui), undefined);
  assert.equal(alert(ui), undefined);
  assert.equal(ui.timerCount(), 0);
  ui.unmount();
});

test('refresh keeps the prior result visible, marks it stale on timeout, then replaces it', async () => {
  const stalled = deferred();
  const requests = [];
  let calls = 0;
  const ui = panel((url, options) => {
    requests.push(options);
    calls++;
    if (calls === 1) return respond(okSnapshot());
    if (calls === 2) return stalled.promise;
    return respond({ ...okSnapshot(), claude: { status: 'token-expired' } });
  });
  toggle(ui);
  await settle();
  const before = checked(ui).props.dateTime;
  assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);

  refresh(ui);
  await settle();
  assert.equal(requests.length, 2);
  assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
  assert.equal(ui.button('usage-panel-refresh').props.disabled, true);
  assert.equal(alert(ui), undefined);

  ui.timeout();
  await settle();
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
  assert.equal(stale(ui).props.role, 'status');
  assert.equal(alert(ui), undefined);
  assert.equal(checked(ui).props.dateTime, before);

  refresh(ui);
  await settle();
  assert.equal(requests.length, 3);
  assertStatus(ui.provider('Claude').props.data, 'token-expired');
  assert.equal(stale(ui), undefined);
  assert.ok(checked(ui));

  stalled.resolve({ ok: true, json: async () => okSnapshot() });
  await settle();
  assertStatus(ui.provider('Claude').props.data, 'token-expired');
  assert.equal(ui.timerCount(), 0);
  ui.unmount();
});

test('valid non-ok statuses replace ok windows', async t => {
  for (const status of ['not-signed-in', 'token-expired', 'unavailable', 'unexpected-format']) {
    await t.test(status, async () => {
      let calls = 0;
      const ui = panel(() => {
        calls++;
        if (calls === 1) return respond(okSnapshot());
        return respond({
          claude: { status, diagnostic: 'raw-secret', fiveHour: { percent: 99, resetsAt: null }, weekly: { percent: 99, resetsAt: null } },
          chatgpt: okSnapshot().chatgpt,
        });
      });
      toggle(ui);
      await settle();
      refresh(ui);
      await settle();
      assertStatus(ui.provider('Claude').props.data, status);
      assert.equal(ui.provider('ChatGPT').props.data.weekly.percent, 65);
      assert.equal(stale(ui), undefined);
      assert.equal(alert(ui), undefined);
      ui.unmount();
    });
  }
});

test('an unrecognized first response shows the load error', async () => {
  const ui = panel(() => respond({ claude: { status: 'mystery' }, chatgpt: { status: ['unavailable'] } }));
  toggle(ui);
  await settle();
  assert.ok(alert(ui));
  assert.equal(ui.provider('Claude'), undefined);
  assert.equal(stale(ui), undefined);
  assert.equal(ui.timerCount(), 0);
  ui.unmount();
});

test('a malformed refresh keeps the prior result and marks it stale', async () => {
  let calls = 0;
  const ui = panel(() => {
    calls++;
    if (calls === 1) return respond(okSnapshot());
    return respond({ ...okSnapshot(), claude: { status: 'ok', fiveHour: { percent: 101, resetsAt: null }, weekly: okSnapshot().claude.weekly } });
  });
  toggle(ui);
  await settle();
  const before = checked(ui).props.dateTime;
  refresh(ui);
  await settle();
  assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
  assert.ok(stale(ui));
  assert.equal(alert(ui), undefined);
  assert.equal(checked(ui).props.dateTime, before);
  ui.unmount();
});

test('closing clears the snapshot and reopening shows no old data', async () => {
  const second = deferred();
  let calls = 0;
  const ui = panel(() => {
    calls++;
    return calls === 1 ? respond(okSnapshot()) : second.promise;
  });
  toggle(ui);
  await settle();
  assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);

  toggle(ui);
  await settle();
  toggle(ui);
  await settle();
  assert.equal(calls, 2);
  assert.equal(ui.provider('Claude'), undefined);
  assert.equal(checked(ui), undefined);
  assert.equal(stale(ui), undefined);
  assert.ok(ui.find(node => node.props.role === 'status' && node.props.className === 'usage-panel-message'));

  second.resolve({ ok: true, json: async () => ({ claude: { status: 'not-signed-in' }, chatgpt: { status: 'unavailable' } }) });
  await settle();
  assertStatus(ui.provider('Claude').props.data, 'not-signed-in');
  assertStatus(ui.provider('ChatGPT').props.data, 'unavailable');
  assert.ok(checked(ui));
  assert.equal(stale(ui), undefined);
  ui.unmount();
});

for (const stage of ['fetch', 'body']) {
  test(`a stalled ${stage} times out, retries, and ignores the late result`, async () => {
    const stalled = deferred();
    const requests = [];
    const ui = panel((url, options) => {
      requests.push(options);
      if (requests.length > 1) return respond(okSnapshot());
      return stage === 'fetch' ? stalled.promise : Promise.resolve({ ok: true, json: () => stalled.promise });
    });
    toggle(ui);
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(ui.button('usage-panel-refresh').props.disabled, true);
    ui.timeout();
    await settle();
    assert.equal(requests[0].signal.aborted, true);
    assert.ok(alert(ui));
    assert.equal(ui.provider('Claude'), undefined);
    refresh(ui);
    await settle();
    assert.equal(requests.length, 2);
    assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
    assert.equal(alert(ui), undefined);
    stalled.resolve(stage === 'fetch'
      ? { ok: true, json: async () => ({ claude: { status: 'not-signed-in' }, chatgpt: { status: 'unavailable' } }) }
      : { claude: { status: 'not-signed-in' }, chatgpt: { status: 'unavailable' } });
    await settle();
    assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
    assert.equal(ui.timerCount(), 0);
    ui.unmount();
  });
}

for (const close of ['trigger', 'Escape', 'outside click']) {
  test(`closing with ${close} cancels usage so reopening starts a fresh request`, async () => {
    const first = deferred();
    const requests = [];
    const ui = panel((url, options) => {
      requests.push(options);
      return requests.length === 1 ? first.promise : respond(okSnapshot());
    });
    toggle(ui);
    ui.render();
    await settle();
    assert.equal(requests.length, 1);
    assert.equal(ui.timerCount(), 1);

    if (close === 'trigger') toggle(ui);
    else if (close === 'Escape') ui.documentEvent('keydown', { key: 'Escape' });
    else ui.documentEvent('pointerdown', { target: {} });
    assert.equal(requests[0].signal.aborted, true);
    assert.equal(ui.timerCount(), 0);

    ui.render();
    await settle();
    toggle(ui);
    ui.render();
    await settle();
    assert.equal(requests.length, 2);
    assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
    first.resolve({ ok: true, json: async () => ({ claude: { status: 'not-signed-in' }, chatgpt: { status: 'unavailable' } }) });
    await settle();
    assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
    assert.equal(ui.timerCount(), 0);
    ui.unmount();
  });
}

test('a failed first request shows an error and a manual retry succeeds without polling', async () => {
  let calls = 0;
  const ui = panel(() => {
    calls++;
    return calls === 1 ? Promise.reject(new Error('network')) : respond(okSnapshot());
  });
  toggle(ui);
  await settle();
  assert.ok(alert(ui));
  refresh(ui);
  await settle();
  assert.equal(alert(ui), undefined);
  assert.equal(ui.button('usage-panel-refresh').props.disabled, false);
  assert.equal(ui.provider('Claude').props.data.fiveHour.percent, 24);
  assert.equal(ui.timerCount(), 0);
  ui.timeout();
  assert.equal(calls, 2);
  ui.unmount();
});

test('unmount aborts a stalled request and removes its deadline', async () => {
  const stalled = deferred();
  let signal;
  const ui = panel((url, options) => { signal = options.signal; return stalled.promise; });
  toggle(ui);
  ui.unmount();
  await settle();
  assert.equal(signal.aborted, true);
  assert.equal(ui.timerCount(), 0);
  stalled.resolve({ ok: true, json: async () => okSnapshot() });
  await settle();
});
