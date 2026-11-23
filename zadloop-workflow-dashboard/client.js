window.__ModuleLoader__.load({
  id: '@local/zadloop-workflow-dashboard',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const TAB_ID = '@local/zadloop-workflow-dashboard/panel';
    const TAB_KIND = 'workflow-dashboard';
    const NS = 'workflowDashboard';
    const REQUEST_TIMEOUT_MS = 10000;

    const styles = `
      .wf-dash-root { height: 100%; box-sizing: border-box; overflow-y: auto; padding: 12px 14px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font-size: 12px; line-height: 1.45; }
      .wf-dash-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-bottom: 8px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
      .wf-dash-title { font-size: 13px; font-weight: 600; }
      .wf-dash-refresh { color: var(--dsw-alias-label-secondary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; padding: 3px 8px; cursor: pointer; font: inherit; }
      .wf-dash-refresh:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .wf-dash-refresh:disabled { opacity: 0.6; cursor: default; }
      .wf-dash-meta { margin-top: 6px; color: var(--dsw-alias-label-secondary); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
      .wf-dash-badge { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .wf-dash-badge-blocked, .wf-dash-badge-failed { color: var(--dsw-alias-state-error-primary, #e5534b); }
      .wf-dash-badge-stale { color: var(--dsw-alias-state-warning-primary, #d29922); }
      .wf-dash-badge-passed, .wf-dash-badge-completed { color: var(--dsw-alias-state-success-primary, #3fb950); }
      .wf-dash-section { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l3, var(--dsw-alias-border-l2)); }
      .wf-dash-section-title { font-weight: 600; margin-bottom: 4px; color: var(--dsw-alias-label-primary); }
      .wf-dash-row { display: flex; justify-content: space-between; gap: 8px; margin-top: 3px; }
      .wf-dash-label { color: var(--dsw-alias-label-secondary); flex: none; }
      .wf-dash-value { text-align: right; overflow-wrap: anywhere; }
      .wf-dash-list { margin: 4px 0 0; padding-left: 16px; }
      .wf-dash-list li { margin-top: 2px; overflow-wrap: anywhere; }
      .wf-dash-details { margin-top: 8px; }
      .wf-dash-details summary { cursor: pointer; font-weight: 600; color: var(--dsw-alias-label-secondary); }
      .wf-dash-message { margin-top: 10px; color: var(--dsw-alias-label-secondary); }
    `;

    const messages = {
      title: 'Workflow',
      guideTitle: 'Workflow Dashboard',
      guideDescription: 'Read-only workflow milestones and verification evidence',
      refresh: 'Refresh',
      loading: 'Loading…',
      loadingStatus: 'Loading workflow evidence…',
      failed: 'Could not load workflow evidence. Try again.',
      readOnlyBadge: 'Read-only · 0 AI calls',
      lastChecked: 'Last checked',
      stale: 'Stale',
      workItem: 'Work item',
      workflowKind: 'Workflow',
      objective: 'Objective',
      stage: 'Stage',
      taskStatus: 'Status',
      liveActivity: 'Live activity',
      reposState: 'Repo / state',
      participantSection: 'Participant & model',
      participant: 'Participant',
      configuredLane: 'Configured',
      executedModel: 'Executed model',
      modelSource: 'Evidence',
      blockers: 'Blockers & open questions',
      noBlockers: 'None recorded.',
      verification: 'Verification',
      counts: 'Counts',
      testedRevision: 'Tested revision',
      sources: 'Sources & evidence',
      scratchpadSource: 'Scratchpad',
      scratchpadUpdated: 'Updated',
      reportSource: 'Test report',
      completedItems: 'Completed / current state',
      decisions: 'Material decisions',
      verificationNotes: 'Verification notes',
      nextAction: 'Next action',
      none: 'None',
    };

    let t = (key) => messages[key] || key;
    let locale;

    function safeString(value, fallback = 'Unknown') {
      return typeof value === 'string' && value.trim() ? value.trim() : fallback;
    }

    function safeList(value) {
      if (!Array.isArray(value)) return [];
      return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
    }

    function sanitizeSnapshot(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      if (raw.readOnly !== true || raw.additionalModelCalls !== 0) return null;
      const wi = raw.workItem && typeof raw.workItem === 'object' ? raw.workItem : null;
      const part = raw.participant && typeof raw.participant === 'object' ? raw.participant : null;
      const ver = raw.verification && typeof raw.verification === 'object' ? raw.verification : null;
      if (!wi || !part || !ver) return null;
      const counts = ver.counts && typeof ver.counts === 'object' ? ver.counts : {};
      return {
        collectedAt: safeString(raw.collectedAt),
        sessionId: safeString(raw.sessionId),
        workItem: {
          sourcePath: safeString(wi.sourcePath),
          updatedAt: safeString(wi.updatedAt),
          stale: Boolean(wi.stale),
          liveActivity: safeString(wi.liveActivity),
          workflowKind: safeString(wi.workflowKind),
          objective: safeString(wi.objective),
          activeItem: safeString(wi.activeItem),
          stage: safeString(wi.stage),
          stageStatus: safeString(wi.stageStatus),
          hasOpenBlockers: Boolean(wi.hasOpenBlockers),
          taskStatus: safeString(wi.taskStatus),
          reposState: safeString(wi.reposState),
          completed: safeList(wi.completed),
          decisions: safeList(wi.decisions),
          blockers: safeList(wi.blockers),
          verificationNotes: safeList(wi.verificationNotes),
          nextAction: safeList(wi.nextAction),
        },
        participant: {
          participant: safeString(part.participant),
          configuredLane: safeString(part.configuredLane),
          executedModel: part.modelVerified === true ? safeString(part.executedModel) : 'Unknown',
          modelVerified: part.modelVerified === true,
          modelEvidenceSource: part.modelVerified === true ? safeString(part.modelEvidenceSource) : 'Unknown',
        },
        verification: {
          sourcePath: safeString(ver.sourcePath),
          status: safeString(ver.status),
          counts: {
            passed: Number.isInteger(counts.passed) && counts.passed >= 0 ? counts.passed : 0,
            failed: Number.isInteger(counts.failed) && counts.failed >= 0 ? counts.failed : 0,
            skipped: Number.isInteger(counts.skipped) && counts.skipped >= 0 ? counts.skipped : 0,
            blocked: Number.isInteger(counts.blocked) && counts.blocked >= 0 ? counts.blocked : 0,
          },
          testedRevision: safeString(ver.testedRevision),
        },
      };
    }

    function statusBadgeClass(status) {
      if (/^Blocked$/i.test(status)) return 'wf-dash-badge wf-dash-badge-blocked';
      if (/^Failed$/i.test(status)) return 'wf-dash-badge wf-dash-badge-failed';
      if (/^Passed$/i.test(status)) return 'wf-dash-badge wf-dash-badge-passed';
      if (/^Completed/i.test(status)) return 'wf-dash-badge wf-dash-badge-completed';
      return 'wf-dash-badge';
    }

    function Row({ label, value, badgeClass }) {
      return h('div', { className: 'wf-dash-row' },
        h('span', { className: 'wf-dash-label' }, label),
        badgeClass
          ? h('span', { className: badgeClass }, value)
          : h('span', { className: 'wf-dash-value' }, value));
    }

    function DetailList({ title, items }) {
      if (!items.length) return null;
      return h('details', { className: 'wf-dash-details' },
        h('summary', null, `${title} (${items.length})`),
        h('ul', { className: 'wf-dash-list' }, ...items.map((item, idx) => h('li', { key: idx }, item))));
    }

    function DashboardBody(props) {
      if (locale) React.useSyncExternalStore(locale.subscribe, locale.getSnapshot);
      const sessionId = typeof props?.sessionId === 'string' && props.sessionId.trim() ? props.sessionId.trim() : '';
      const [loading, setLoading] = React.useState(false);
      const [snapshot, setSnapshot] = React.useState(null);
      const [stale, setStale] = React.useState(false);
      const [error, setError] = React.useState(false);
      const inFlight = React.useRef(null);
      const activeSession = React.useRef(sessionId);
      const mounted = React.useRef(true);

      function cancelRequest() {
        const current = inFlight.current;
        inFlight.current = null;
        if (current) current.cancel();
      }

      async function loadSnapshot(targetSession, keepPrior) {
        cancelRequest();
        const controller = new AbortController();
        let timer;
        let rejectDeadline;
        const deadline = new Promise((_, reject) => {
          rejectDeadline = reject;
          timer = setTimeout(() => { controller.abort(); reject(new Error('Request timed out')); }, REQUEST_TIMEOUT_MS);
        });
        const cancel = () => {
          clearTimeout(timer);
          controller.abort();
          rejectDeadline(new Error('Cancelled'));
        };
        const request = { cancel, sessionId: targetSession };
        inFlight.current = request;
        setLoading(true);
        if (!keepPrior) setError(false);
        const query = targetSession ? `?sessionId=${encodeURIComponent(targetSession)}` : '';
        try {
          const result = await Promise.race([deadline, (async () => {
            const response = await fetch(`/api/workflow-dashboard${query}`, {
              credentials: 'same-origin',
              cache: 'no-store',
              signal: controller.signal,
            });
            if (controller.signal.aborted || !response.ok) throw new Error('Dashboard unavailable');
            return response.json();
          })()]);
          const data = sanitizeSnapshot(result);
          if (!data) throw new Error('Invalid dashboard response');
          if (mounted.current && inFlight.current === request && activeSession.current === targetSession) {
            setSnapshot({ data, checkedAt: Date.now() });
            setStale(false);
            setError(false);
          }
        } catch (_) {
          if (mounted.current && inFlight.current === request && activeSession.current === targetSession) {
            if (keepPrior) setStale(true);
            else { setSnapshot(null); setError(true); }
          }
        } finally {
          clearTimeout(timer);
          if (inFlight.current === request) {
            inFlight.current = null;
            if (mounted.current) setLoading(false);
          }
        }
      }

      React.useEffect(() => {
        mounted.current = true;
        activeSession.current = sessionId;
        setSnapshot(null);
        setStale(false);
        setError(false);
        loadSnapshot(sessionId, false);
        return () => {
          mounted.current = false;
          cancelRequest();
        };
      }, [sessionId]);

      function refresh() {
        loadSnapshot(sessionId, Boolean(snapshot));
      }

      const data = snapshot ? snapshot.data : null;
      const checkedAt = snapshot ? new Date(snapshot.checkedAt) : null;
      const isStale = stale || Boolean(data && data.workItem.stale);

      return h('div', { className: 'wf-dash-root', 'data-session-id': sessionId || 'none' },
        h('style', null, styles),
        h('div', { className: 'wf-dash-header' },
          h('span', { className: 'wf-dash-title' }, t('title')),
          h('button', { type: 'button', className: 'wf-dash-refresh', onClick: refresh, disabled: loading },
            loading ? t('loading') : t('refresh'))),
        h('div', { className: 'wf-dash-meta' },
          h('span', { className: 'wf-dash-badge' }, t('readOnlyBadge')),
          checkedAt ? h('span', null, `${t('lastChecked')}: `, h('time', { dateTime: checkedAt.toISOString() }, checkedAt.toLocaleString())) : null,
          isStale ? h('span', { className: 'wf-dash-badge wf-dash-badge-stale', role: 'status' }, t('stale')) : null),
        error && !data ? h('div', { className: 'wf-dash-message', role: 'alert' }, t('failed')) : null,
        !data && !error && loading ? h('div', { className: 'wf-dash-message', role: 'status' }, t('loadingStatus')) : null,
        data ? h(React.Fragment, null,
          h('div', { className: 'wf-dash-section' },
            h('div', { className: 'wf-dash-section-title' }, t('workItem')),
            h(Row, { label: t('workItem'), value: data.workItem.activeItem }),
            h(Row, { label: t('workflowKind'), value: data.workItem.workflowKind }),
            h(Row, { label: t('objective'), value: data.workItem.objective }),
            h(Row, { label: t('stage'), value: `${data.workItem.stage} (${data.workItem.stageStatus})` }),
            h(Row, { label: t('taskStatus'), value: data.workItem.taskStatus, badgeClass: statusBadgeClass(data.workItem.taskStatus) }),
            h(Row, { label: t('liveActivity'), value: data.workItem.liveActivity }),
            h(Row, { label: t('reposState'), value: data.workItem.reposState })),
          h('div', { className: 'wf-dash-section' },
            h('div', { className: 'wf-dash-section-title' }, t('participantSection')),
            h(Row, { label: t('participant'), value: data.participant.participant }),
            h(Row, { label: t('configuredLane'), value: data.participant.configuredLane }),
            h(Row, { label: t('executedModel'), value: data.participant.executedModel }),
            data.participant.modelVerified
              ? h(Row, { label: t('modelSource'), value: data.participant.modelEvidenceSource })
              : null),
          h('div', { className: 'wf-dash-section' },
            h('div', { className: 'wf-dash-section-title' }, t('blockers')),
            data.workItem.blockers.length
              ? h('ul', { className: 'wf-dash-list' }, ...data.workItem.blockers.map((item, idx) => h('li', { key: idx }, item)))
              : h('div', { className: 'wf-dash-message' }, t('noBlockers'))),
          h('div', { className: 'wf-dash-section' },
            h('div', { className: 'wf-dash-section-title' }, t('verification')),
            h(Row, { label: t('taskStatus'), value: data.verification.status, badgeClass: statusBadgeClass(data.verification.status) }),
            h(Row, { label: t('counts'), value: `${data.verification.counts.passed} passed · ${data.verification.counts.failed} failed · ${data.verification.counts.skipped} skipped · ${data.verification.counts.blocked} blocked` }),
            h(Row, { label: t('testedRevision'), value: data.verification.testedRevision })),
          h('div', { className: 'wf-dash-section' },
            h('div', { className: 'wf-dash-section-title' }, t('sources')),
            h(Row, { label: t('scratchpadSource'), value: data.workItem.sourcePath }),
            h(Row, { label: t('scratchpadUpdated'), value: data.workItem.updatedAt }),
            h(Row, { label: t('reportSource'), value: data.verification.sourcePath }),
            h(DetailList, { title: t('completedItems'), items: data.workItem.completed }),
            h(DetailList, { title: t('decisions'), items: data.workItem.decisions }),
            h(DetailList, { title: t('verificationNotes'), items: data.workItem.verificationNotes }),
            h(DetailList, { title: t('nextAction'), items: data.workItem.nextAction }))) : null);
    }

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        locale = { subscribe: ctx.locale.subscribe.bind(ctx.locale), getSnapshot: ctx.locale.getSnapshot.bind(ctx.locale) };
        t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, 'en', messages), 'workflow-dashboard: locale');
        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => t('title'),
          guide: [{
            id: 'open',
            order: 40,
            title: () => t('guideTitle'),
            description: () => t('guideDescription'),
          }],
        }), 'workflow-dashboard: tab type');
        ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TAB_ID,
          locale: NS,
          inject: (sessionId) => ({ sessionId }),
        }, DashboardBody)), 'workflow-dashboard: tab body');
      },
    };
  },
});
