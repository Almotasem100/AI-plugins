window.__ModuleLoader__.load({
  id: '@local/usage-panel',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const styles = `
      .usage-panel-trigger, .usage-panel-refresh { color: var(--dsw-alias-label-secondary); background: transparent; border: 0; cursor: pointer; font: inherit; }
      .usage-panel-trigger { display: inline-flex; align-items: center; padding: 4px 6px; border-radius: 6px; }
      .usage-panel-trigger:hover, .usage-panel-refresh:hover { background: var(--dsw-alias-bg-layer-2); }
      .usage-panel-popover { position: fixed; z-index: 1000; width: min(320px, calc(100vw - 16px)); max-height: calc(100vh - 16px); overflow-y: auto; box-sizing: border-box; padding: 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary); font-size: 13px; }
      .usage-panel-heading { display: flex; justify-content: space-between; align-items: center; font-weight: 600; }
      .usage-panel-provider { margin-top: 14px; }
      .usage-panel-window { margin-top: 8px; }
      .usage-panel-line { display: flex; justify-content: space-between; gap: 12px; }
      .usage-panel-bar { height: 5px; margin-top: 5px; overflow: hidden; border-radius: 5px; background: var(--dsw-alias-bg-layer-2); }
      .usage-panel-bar > span { display: block; height: 100%; background: var(--dsw-alias-label-secondary); }
      .usage-panel-reset, .usage-panel-message { margin-top: 4px; color: var(--dsw-alias-label-secondary); }
    `;
    const messages = {
      title: 'Subscription usage', refresh: 'Refresh', loading: 'Loading…',
      loadingUsage: 'Loading usage…', failed: 'Could not load usage. Try again.',
      fiveHour: '5-hour', weekly: 'Weekly', unavailable: 'Usage is unavailable. Try again.',
      windowUnavailable: 'unavailable', resets: 'Resets', resetUnavailable: 'Reset time unavailable',
      notSignedIn: 'Not signed in.', tokenExpired: 'Session expired. Use the model once or sign in again.',
      unexpected: 'Usage response was not recognized.',
    };
    let t;
    let locale;

    function WindowUsage({ label, value }) {
      if (!value || !Number.isFinite(value.percent)) {
        return h('div', { className: 'usage-panel-window' }, label + ': ' + t('windowUnavailable'));
      }
      const percent = Math.max(0, Math.min(100, value.percent));
      const reset = value.resetsAt ? new Date(value.resetsAt) : null;
      const resetText = reset && Number.isFinite(reset.getTime()) ? t('resets') + ' ' + reset.toLocaleString() : t('resetUnavailable');
      return h('div', { className: 'usage-panel-window' },
        h('div', { className: 'usage-panel-line' }, h('span', null, label), h('span', null, `${percent}%`)),
        h('div', { className: 'usage-panel-bar', role: 'progressbar', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent }, h('span', { style: { width: `${percent}%` } })),
        h('div', { className: 'usage-panel-reset' }, resetText));
    }

    function Provider({ name, data }) {
      return h('section', { className: 'usage-panel-provider', 'aria-label': name },
        h('strong', null, name),
        data && data.status === 'ok'
          ? h(React.Fragment, null, h(WindowUsage, { label: t('fiveHour'), value: data.fiveHour }), h(WindowUsage, { label: t('weekly'), value: data.weekly }))
          : h('div', { className: 'usage-panel-message' }, t(({ 'not-signed-in': 'notSignedIn', 'token-expired': 'tokenExpired', 'unexpected-format': 'unexpected' })[data && data.status] || 'unavailable')));
    }

    function UsagePanel() {
      React.useSyncExternalStore(locale.subscribe, locale.getSnapshot);
      const [open, setOpen] = React.useState(false);
      const [loading, setLoading] = React.useState(false);
      const [data, setData] = React.useState(null);
      const [error, setError] = React.useState(false);
      const [position, setPosition] = React.useState({ top: 8, left: 8 });
      const trigger = React.useRef(null);
      const popover = React.useRef(null);
      const inFlight = React.useRef(null);
      const mounted = React.useRef(true);

      function cancelUsage() {
        const request = inFlight.current;
        inFlight.current = null;
        if (request) request.cancel();
      }
      function closePanel() {
        cancelUsage();
        setOpen(false);
      }
      React.useEffect(() => {
        mounted.current = true;
        return () => {
          mounted.current = false;
          cancelUsage();
        };
      }, []);
      React.useEffect(() => {
        if (open) popover.current?.focus();
      }, [open]);
      React.useEffect(() => {
        if (!open) return;
        function place() {
          if (!trigger.current || !popover.current) return;
          const anchor = trigger.current.getBoundingClientRect();
          const panel = popover.current.getBoundingClientRect();
          setPosition({ top: Math.max(8, anchor.top - panel.height - 8), left: Math.max(8, Math.min(anchor.right - panel.width, window.innerWidth - panel.width - 8)) });
        }
        function outside(event) {
          if (!trigger.current?.contains(event.target) && !popover.current?.contains(event.target)) closePanel();
        }
        function keydown(event) {
          if (event.key === 'Escape') { closePanel(); trigger.current?.focus(); }
        }
        place();
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', keydown);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          document.removeEventListener('pointerdown', outside);
          document.removeEventListener('keydown', keydown);
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [open, loading, data, error]);

      async function refresh() {
        if (inFlight.current) return;
        const controller = new AbortController();
        let timer;
        let cancel;
        const deadline = new Promise((_, reject) => {
          cancel = () => {
            clearTimeout(timer);
            reject(new Error('Usage request cancelled'));
            controller.abort();
          };
          timer = setTimeout(cancel, 15000);
        });
        const request = { cancel };
        inFlight.current = request;
        setLoading(true);
        setError(false);
        setData(null);
        try {
          const result = await Promise.race([deadline, (async () => {
            const response = await fetch('/api/usage-panel', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
            if (controller.signal.aborted || !response.ok) throw new Error('Usage unavailable');
            return response.json();
          })()]);
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid response');
          if (mounted.current && inFlight.current === request) setData(result);
        } catch (_) {
          if (mounted.current && inFlight.current === request) { setData(null); setError(true); }
        } finally {
          clearTimeout(timer);
          if (inFlight.current === request) {
            inFlight.current = null;
            if (mounted.current) setLoading(false);
          }
        }
      }
      function toggle() {
        if (open) closePanel();
        else { refresh(); setOpen(true); }
      }
      return h(React.Fragment, null,
        h('style', null, styles),
        h('button', { ref: trigger, type: 'button', className: 'usage-panel-trigger', onClick: toggle, title: t('title'), 'aria-label': t('title'), 'aria-haspopup': 'dialog', 'aria-expanded': open },
          h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, 'aria-hidden': true }, h('path', { d: 'M4 19V11m5 8V5m5 14v-6m5 6V8' }))),
        open && createPortal(h('div', { ref: popover, className: 'usage-panel-popover', role: 'dialog', tabIndex: -1, 'aria-label': t('title'), style: position },
          h('div', { className: 'usage-panel-heading' }, h('span', null, t('title')), h('button', { type: 'button', className: 'usage-panel-refresh', onClick: refresh, disabled: loading }, loading ? t('loading') : t('refresh'))),
          error ? h('div', { className: 'usage-panel-message', role: 'alert' }, t('failed')) : null,
          data ? h(React.Fragment, null, h(Provider, { name: 'Claude', data: data.claude }), h(Provider, { name: 'ChatGPT', data: data.chatgpt })) : (!error && loading ? h('div', { className: 'usage-panel-message', role: 'status' }, t('loadingUsage')) : null)
        ), document.body));
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        locale = { subscribe: ctx.locale.subscribe.bind(ctx.locale), getSnapshot: ctx.locale.getSnapshot.bind(ctx.locale) };
        t = ctx.locale.bind('usage-panel');
        ctx.effect(() => ctx.locale.register('usage-panel', 'en', messages));
        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({ name: 'conversation.composer.dock', id: 'usage-panel', order: 2 }, UsagePanel));
      },
    };
  },
});
