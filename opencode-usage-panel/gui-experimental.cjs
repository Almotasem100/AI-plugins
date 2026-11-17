'use strict'

// OpenCode Desktop 2.3.0 shared GUI and RPC modules.
const { Plugin, Slot } = require('@opencode/plugin/gui')
const { Rpc } = require('@opencode/plugin/rpc')
const { createComponent, createEffect, createRoot, onCleanup } = require('solid-js')

const windowSchema = {
  type: 'object',
  properties: { percent: { type: 'number', minimum: 0, maximum: 100 }, resetsAt: { type: ['string', 'null'] } },
  required: ['percent', 'resetsAt'], additionalProperties: false,
}
const providerSchema = {
  type: 'object',
  properties: {
    status: { enum: ['ok', 'not-signed-in', 'token-expired', 'unavailable', 'unexpected-format'] },
    fiveHour: windowSchema, weekly: windowSchema,
  },
  required: ['status'], additionalProperties: false,
}
const Usage = Rpc.define({
  id: 'subscription-usage',
  events: {},
  methods: { refresh: { input: { type: 'null' }, output: {
    type: 'object', properties: { claude: providerSchema, chatgpt: providerSchema },
    required: ['claude', 'chatgpt'], additionalProperties: false,
  } } },
})

const statusText = {
  'not-signed-in': 'Not signed in',
  'token-expired': 'Session expired',
  unavailable: 'Unavailable',
  'unexpected-format': 'Usage data unavailable',
}

function displayWindow(value) {
  if (!value || typeof value.percent !== 'number' || !Number.isFinite(value.percent) || value.percent < 0 || value.percent > 100) return null
  if (value.resetsAt !== null && (typeof value.resetsAt !== 'string' || !Number.isFinite(Date.parse(value.resetsAt)))) return null
  return `${value.percent}% used · ${value.resetsAt === null ? 'Reset unknown' : `Resets ${new Date(value.resetsAt).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}`}`
}

function providerText(value) {
  if (!value || typeof value !== 'object') return ['Usage data unavailable']
  if (value.status !== 'ok') return [statusText[value.status] || 'Usage data unavailable']
  const five = displayWindow(value.fiveHour)
  const week = displayWindow(value.weekly)
  return [`5-hour: ${five || 'Unavailable'}`, `Weekly: ${week || 'Unavailable'}`]
}

module.exports = { default: Plugin.define({
  setup(ctx) {
    ctx.add(Slot, {
      at: 'session.header',
      order: 9,
      render(input) {
        return headerControl(ctx, input)
      },
    })
  },
}) }

let popupSequence = 0

function headerControl(ctx, input) {
  const wrapper = document.createElement('div')
  const popup = document.createElement('div')
  popup.id = `subscription-usage-${++popupSequence}`
  popup.setAttribute('popover', 'auto')
  popup.setAttribute('aria-label', 'Subscription usage')
  popup.style.position = 'fixed'
  popup.style.margin = '0'
  popup.style.padding = '0'
  popup.style.border = '1px solid var(--border-base, #50576b)'
  popup.style.borderRadius = '8px'
  popup.style.background = 'var(--background-base, #252b3d)'
  popup.style.color = 'var(--text-base, #fff)'
  popup.style.boxShadow = '0 6px 20px #0004'
  popup.style.overflowY = 'auto'
  let disposePanel
  let openedSession
  function clearPanel() {
    window.removeEventListener('resize', positionPopup)
    window.removeEventListener('scroll', positionPopup, true)
    disposePanel?.()
    disposePanel = undefined
    popup.replaceChildren()
    openedSession = undefined
  }
  function closePanel() {
    if (popup.matches(':popover-open')) popup.hidePopover()
    clearPanel()
  }
  function positionPopup() {
    const bounds = button.getBoundingClientRect()
    const below = window.innerHeight - bounds.bottom - 8
    const above = bounds.top - 8
    const placeAbove = below < 200 && above > below
    popup.style.maxHeight = `${Math.max(0, Math.min(320, placeAbove ? above : below))}px`
    popup.style.top = placeAbove ? 'auto' : `${bounds.bottom + 4}px`
    popup.style.bottom = placeAbove ? `${window.innerHeight - bounds.top + 4}px` : 'auto'
    const maxRight = Math.max(8, window.innerWidth - popup.getBoundingClientRect().width - 8)
    popup.style.right = `${Math.min(maxRight, Math.max(8, window.innerWidth - bounds.right))}px`
    popup.style.left = 'auto'
  }
  const button = createComponent(ctx.ui.IconButton, {
    icon: 'window-analytics', label: 'Subscription usage',
    onClick(event) {
      if (popup.matches(':popover-open')) return closePanel()
      clearPanel()
      const session = input.session
      openedSession = session.key
      createRoot(dispose => { disposePanel = dispose; popup.append(usagePanel(session)) })
      positionPopup()
      window.addEventListener('resize', positionPopup)
      window.addEventListener('scroll', positionPopup, true)
      popup.showPopover()
      positionPopup()
      if (event.detail === 0) popup.querySelector('button')?.focus()
    },
  })
  button.setAttribute('title', 'Subscription usage')
  button.setAttribute('aria-controls', popup.id)
  button.setAttribute('aria-haspopup', 'dialog')
  button.setAttribute('aria-expanded', 'false')
  popup.setAttribute('role', 'dialog')
  popup.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    closePanel()
    button.focus()
  })
  popup.addEventListener('toggle', () => {
    const open = popup.matches(':popover-open')
    button.setAttribute('aria-expanded', String(open))
    if (!open) clearPanel()
  })
  createEffect(() => {
    const session = input.session.key
    if (!input.active || (openedSession && openedSession !== session)) closePanel()
  })
  onCleanup(closePanel)
  wrapper.append(button, popup)
  return wrapper
}

function usagePanel(session) {
        const root = document.createElement('div')
        root.style.padding = '8px'
        root.style.width = '300px'
        root.style.maxWidth = 'calc(100vw - 48px)'
        root.style.maxHeight = 'min(300px, calc(100vh - 100px))'
        root.style.overflowY = 'auto'
        root.style.fontSize = '12px'
        root.style.lineHeight = '1.25'
        const body = document.createElement('div')
        body.setAttribute('aria-live', 'polite')
        const refresh = document.createElement('button')
        refresh.type = 'button'
        refresh.textContent = 'Refresh'
        root.append(body, refresh)
        let disposed = false
        let busy = false
        let generation = 0
        let timer
        function text(message) { body.replaceChildren(document.createTextNode(message)) }
        function section(name, value) {
          const container = document.createElement('section')
          container.style.marginBottom = '8px'
          const heading = document.createElement('h3')
          heading.style.margin = '0 0 4px'
          heading.style.fontSize = 'inherit'
          heading.textContent = name
          container.setAttribute('aria-label', name)
          container.append(heading)
          for (const [index, line] of providerText(value).entries()) {
            const row = document.createElement('div')
            row.textContent = line
            container.append(row)
            const window = index === 0 ? value?.fiveHour : value?.weekly
            if (value?.status === 'ok' && displayWindow(window)) {
              const bar = document.createElement('progress')
              bar.max = 100
              bar.value = window.percent
              bar.style.display = 'block'
              bar.style.width = '100%'
              bar.style.height = '5px'
              bar.style.margin = '2px 0 4px'
              bar.setAttribute('aria-label', `${name} ${index === 0 ? '5-hour' : 'weekly'} usage`)
              container.append(bar)
            }
          }
          return container
        }
        async function load() {
          if (busy) return
          busy = true
          const current = ++generation
          clearTimeout(timer)
          refresh.setAttribute('aria-disabled', 'true')
          text('Loading usage…')
          let timedOut = false
          try {
            const timeout = new Promise((_, reject) => {
              timer = setTimeout(() => { timedOut = true; reject(new Error('timeout')) }, 15000)
            })
            const result = await Promise.race([Promise.resolve().then(() => disposed ? undefined : session.server.client.rpc(Usage).refresh(null, { location: session.location })), timeout])
            if (disposed || current !== generation) return
            body.replaceChildren(section('Claude', result?.claude), section('ChatGPT', result?.chatgpt))
          } catch {
            if (!disposed && current === generation) text(timedOut ? 'Usage request timed out.' : 'Unable to load usage.')
          } finally {
            if (current === generation) {
              clearTimeout(timer)
              busy = false
              if (!disposed) refresh.setAttribute('aria-disabled', 'false')
            }
          }
        }
        refresh.addEventListener('click', load)
        onCleanup(() => { disposed = true; generation++; clearTimeout(timer) })
        void load()
        return root
}
