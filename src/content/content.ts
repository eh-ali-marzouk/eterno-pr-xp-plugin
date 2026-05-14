import browser from 'webextension-polyfill'
import type {
  AuthUserPayload,
  GrantInput,
  GrantRow,
  Message,
  PrRow,
  Response
} from '../lib/messages'
import { readPrPageInfo } from './pr-page'

const PANEL_ID = 'pr-xp-panel'

const SIDEBAR_SELECTORS = [
  '.discussion-sidebar',
  '#partial-discussion-sidebar',
  '.Layout-sidebar',
  '[data-testid="sidebar"]',
  '[data-testid="issue-viewer-metadata-container"]',
  '[data-testid="issue-viewer-metadata-pane"]',
  'div[class*="SidebarSection"]',
  'aside[aria-label="Sidebar"]'
]

const styles = {
  sidebar: [
    'margin-top:16px',
    'padding:12px',
    'border:1px solid var(--color-border-default, #d0d7de)',
    'border-radius:6px',
    'background:var(--color-canvas-subtle, #f6f8fa)',
    'color:var(--color-fg-default, #1f2328)',
    'font-size:12px',
    'line-height:1.5'
  ].join(';'),
  floating: [
    'position:fixed',
    'bottom:16px',
    'right:16px',
    'z-index:2147483647',
    'padding:12px 14px',
    'border:1px solid var(--color-border-default, #d0d7de)',
    'border-radius:8px',
    'background:var(--color-canvas-default, #ffffff)',
    'color:var(--color-fg-default, #1f2328)',
    'font-size:12px',
    'line-height:1.5',
    'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
    'min-width:220px',
    'max-width:340px'
  ].join(';')
}

function findSidebar(): Element | null {
  for (const sel of SIDEBAR_SELECTORS) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  const headings = document.querySelectorAll('h2, h3')
  for (const h of headings) {
    if (/^Reviewers$/i.test(h.textContent?.trim() ?? '')) {
      let node: Element | null = h
      for (let i = 0; i < 6 && node; i++) {
        const parent = node.parentElement
        if (!parent) break
        if (parent.tagName === 'ASIDE' || parent.getAttribute('role') === 'complementary') {
          return parent
        }
        node = parent
      }
      return h.parentElement
    }
  }
  return null
}

async function send<T = unknown>(msg: Message): Promise<Response<T>> {
  return (await browser.runtime.sendMessage(msg)) as Response<T>
}

// ---------- rendering helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { style?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style' && typeof v === 'string') node.setAttribute('style', v)
    else if (v !== undefined) (node as Record<string, unknown>)[k] = v
  }
  for (const c of children) node.append(c)
  return node
}

function rowStyle(): string {
  return 'display:flex;align-items:center;gap:6px;margin-top:6px'
}

function btnStyle(primary = false): string {
  const base =
    'padding:4px 10px;border-radius:6px;border:1px solid var(--color-border-default,#d0d7de);' +
    'font:inherit;font-size:12px;cursor:pointer;'
  return primary
    ? base +
        'background:var(--color-btn-primary-bg,#1f883d);color:var(--color-btn-primary-text,#fff);border-color:transparent;'
    : base + 'background:var(--color-btn-bg,#f6f8fa);color:var(--color-fg-default,#1f2328);'
}

// ---------- main render ----------

type PanelState = {
  signedIn: boolean
  myLogin: string | null
  info: ReturnType<typeof readPrPageInfo>
  pr: PrRow | null
  grants: GrantRow[]
  participants: string[] | null  // null until fetched
  error: string | null
  busy: boolean
  mode: 'view' | 'edit-pool' | 'distribute'
  // distribute-mode local state
  draft: Record<string, number>
}

const state: PanelState = {
  signedIn: false,
  myLogin: null,
  info: null,
  pr: null,
  grants: [],
  participants: null,
  error: null,
  busy: false,
  mode: 'view',
  draft: {}
}

function ensurePanel(): HTMLElement | null {
  let panel = document.getElementById(PANEL_ID) as HTMLElement | null
  if (panel) return panel

  const sidebar = findSidebar()
  panel = document.createElement('div')
  panel.id = PANEL_ID
  if (sidebar) {
    panel.setAttribute('style', styles.sidebar)
    sidebar.appendChild(panel)
  } else {
    panel.setAttribute('style', styles.floating)
    document.body.appendChild(panel)
  }
  return panel
}

function render() {
  const panel = ensurePanel()
  if (!panel) return
  panel.replaceChildren(buildContent())
}

function buildContent(): DocumentFragment {
  const frag = document.createDocumentFragment()

  frag.appendChild(
    el('div', {
      style: 'font-weight:600;margin-bottom:6px;display:flex;align-items:center;gap:6px'
    }, ['PR XP'])
  )

  if (!state.info) {
    frag.appendChild(el('div', {}, ['Not a PR page']))
    return frag
  }

  if (!state.signedIn) {
    frag.appendChild(el('div', {}, ['Sign in via the extension popup to use PR XP.']))
    return frag
  }

  if (state.error) {
    frag.appendChild(
      el('div', { style: 'color:#cf222e;margin-top:4px;word-break:break-word' }, [
        state.error
      ])
    )
  }

  const iAmAuthor = !!state.myLogin && state.myLogin === state.info.authorLogin
  const pr = state.pr
  const distributed = pr?.status === 'distributed'

  // --- pool display / edit ---
  if (!pr) {
    if (iAmAuthor) {
      // Insert may have been blocked (RLS, network). The error is rendered above.
      if (!state.error) {
        frag.appendChild(el('div', {}, ['Loading…']))
      }
    } else {
      frag.appendChild(el('div', { style: 'opacity:0.8' }, ['No XP pool set yet.']))
    }
  } else if (state.mode === 'edit-pool') {
    frag.appendChild(renderEditPool(pr))
  } else {
    frag.appendChild(renderPoolView(pr, iAmAuthor, distributed))
  }

  // --- grants list when distributed ---
  if (distributed && state.grants.length > 0) {
    frag.appendChild(renderGrantsList(state.grants))
  }

  // --- distribute form ---
  if (pr && !distributed && iAmAuthor && state.info.isMerged && state.mode === 'distribute') {
    frag.appendChild(renderDistribute(pr))
  }

  return frag
}

function renderPoolView(pr: PrRow, iAmAuthor: boolean, distributed: boolean): HTMLElement {
  const container = el('div', { style: 'margin-top:4px' })
  container.appendChild(
    el('div', {}, [
      `XP pool: ${pr.xp_pool}`,
      ...(distributed ? [el('span', { style: 'margin-left:6px;opacity:0.7' }, ['(distributed)'])] : [])
    ])
  )
  if (iAmAuthor && !distributed) {
    const editBtn = el('button', { style: btnStyle(false) }, ['Edit pool'])
    editBtn.onclick = () => {
      state.mode = 'edit-pool'
      render()
    }
    const row = el('div', { style: rowStyle() }, [editBtn])

    if (state.info?.isMerged) {
      const distBtn = el('button', { style: btnStyle(true) }, ['Distribute XP'])
      distBtn.onclick = () => startDistribute()
      row.appendChild(distBtn)
    }
    container.appendChild(row)
  }
  return container
}

function renderEditPool(pr: PrRow): HTMLElement {
  const input = el('input', {
    type: 'number',
    min: '0',
    step: '1',
    value: String(pr.xp_pool),
    style:
      'width:90px;padding:3px 6px;font:inherit;font-size:12px;' +
      'border:1px solid var(--color-border-default,#d0d7de);border-radius:6px;' +
      'background:var(--color-canvas-default,#fff);color:var(--color-fg-default,#1f2328)'
  }) as HTMLInputElement

  const saveBtn = el('button', { style: btnStyle(true) }, ['Save'])
  saveBtn.onclick = async () => {
    const next = Number(input.value)
    if (!Number.isFinite(next) || next < 0 || !Number.isInteger(next)) {
      state.error = 'XP pool must be a non-negative integer'
      render()
      return
    }
    state.busy = true
    state.error = null
    saveBtn.disabled = true
    const res = await send<PrRow>({ type: 'PR_SET_POOL', pr_id: pr.id, xp_pool: next })
    state.busy = false
    if (!res.ok) {
      state.error = res.error
      render()
      return
    }
    state.pr = res.data ?? state.pr
    state.mode = 'view'
    render()
  }

  const cancelBtn = el('button', { style: btnStyle(false) }, ['Cancel'])
  cancelBtn.onclick = () => {
    state.mode = 'view'
    state.error = null
    render()
  }

  return el('div', { style: rowStyle() }, [
    el('span', { style: 'margin-right:2px' }, ['Pool:']),
    input,
    saveBtn,
    cancelBtn
  ])
}

function renderGrantsList(grants: GrantRow[]): HTMLElement {
  const list = el('div', {
    style: 'margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border-muted,#d0d7de40)'
  })
  list.appendChild(el('div', { style: 'font-weight:600;margin-bottom:4px' }, ['Distribution']))
  for (const g of grants) {
    list.appendChild(
      el(
        'div',
        { style: 'display:flex;justify-content:space-between;gap:8px;margin-top:2px' },
        [
          el('span', {}, [`@${g.recipient_github_login}`]),
          el('span', { style: 'opacity:0.85' }, [`${g.points} XP (${g.percentage}%)`])
        ]
      )
    )
  }
  return list
}

async function startDistribute() {
  if (!state.info || !state.pr) return
  state.busy = true
  state.error = null
  state.mode = 'distribute'
  render()
  const res = await send<string[]>({
    type: 'PR_FETCH_PARTICIPANTS',
    repo: state.info.repo,
    pr_number: state.info.prNumber,
    author_github_login: state.info.authorLogin ?? ''
  })
  state.busy = false
  if (!res.ok) {
    state.error = res.error
    state.mode = 'view'
    render()
    return
  }
  state.participants = res.data ?? []
  state.draft = {}
  for (const p of state.participants) state.draft[p] = 0
  render()
}

function renderDistribute(pr: PrRow): HTMLElement {
  const wrap = el('div', {
    style: 'margin-top:10px;padding-top:8px;border-top:1px solid var(--color-border-muted,#d0d7de40)'
  })
  wrap.appendChild(el('div', { style: 'font-weight:600;margin-bottom:4px' }, ['Distribute XP']))

  if (state.participants === null) {
    wrap.appendChild(el('div', {}, ['Loading participants…']))
    return wrap
  }
  if (state.participants.length === 0) {
    wrap.appendChild(el('div', {}, ['No reviewers or commenters found.']))
    const cancel = el('button', { style: btnStyle(false) }, ['Cancel'])
    cancel.onclick = () => {
      state.mode = 'view'
      render()
    }
    wrap.appendChild(el('div', { style: rowStyle() }, [cancel]))
    return wrap
  }

  const totalEl = el('div', { style: 'margin-top:6px;opacity:0.85' }, [])
  const updateTotal = () => {
    const sum = Object.values(state.draft).reduce((a, b) => a + b, 0)
    totalEl.textContent = `Total: ${sum}% ${sum === 100 ? '✓' : `(need ${100 - sum > 0 ? 100 - sum + ' more' : Math.abs(100 - sum) + ' less'})`}`
    submitBtn.disabled = sum !== 100 || state.busy
  }

  for (const login of state.participants) {
    const row = el('div', {
      style: 'display:flex;align-items:center;gap:6px;margin-top:4px'
    })
    row.appendChild(el('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, [`@${login}`]))
    const slider = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(state.draft[login] ?? 0),
      style: 'width:90px'
    }) as HTMLInputElement
    const numInput = el('input', {
      type: 'number',
      min: '0',
      max: '100',
      step: '1',
      value: String(state.draft[login] ?? 0),
      style:
        'width:52px;padding:2px 4px;font:inherit;font-size:12px;' +
        'border:1px solid var(--color-border-default,#d0d7de);border-radius:6px;' +
        'background:var(--color-canvas-default,#fff);color:var(--color-fg-default,#1f2328)'
    }) as HTMLInputElement
    const sync = (val: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(val)))
      state.draft[login] = clamped
      slider.value = String(clamped)
      numInput.value = String(clamped)
      updateTotal()
    }
    slider.addEventListener('input', () => sync(Number(slider.value)))
    numInput.addEventListener('input', () => sync(Number(numInput.value)))
    row.appendChild(slider)
    row.appendChild(numInput)
    row.appendChild(el('span', { style: 'opacity:0.6' }, ['%']))
    wrap.appendChild(row)
  }

  wrap.appendChild(totalEl)

  const submitBtn = el('button', { style: btnStyle(true) }, ['Submit']) as HTMLButtonElement
  submitBtn.onclick = async () => {
    const grants: GrantInput[] = Object.entries(state.draft)
      .filter(([, pct]) => pct > 0)
      .map(([login, pct]) => ({ recipient_github_login: login, percentage: pct }))
    state.busy = true
    state.error = null
    submitBtn.disabled = true
    const res = await send<PrRow>({
      type: 'PR_DISTRIBUTE',
      pr_id: pr.id,
      xp_pool: pr.xp_pool,
      grants
    })
    state.busy = false
    if (!res.ok) {
      state.error = res.error
      render()
      return
    }
    state.pr = res.data ?? state.pr
    state.mode = 'view'
    state.participants = null
    state.draft = {}
    await refreshGrants()
  }

  const cancelBtn = el('button', { style: btnStyle(false) }, ['Cancel'])
  cancelBtn.onclick = () => {
    state.mode = 'view'
    state.participants = null
    state.draft = {}
    state.error = null
    render()
  }

  wrap.appendChild(el('div', { style: rowStyle() }, [submitBtn, cancelBtn]))
  updateTotal()
  return wrap
}

async function refreshGrants() {
  if (!state.pr) return
  const res = await send<GrantRow[]>({ type: 'PR_LIST_GRANTS', pr_id: state.pr.id })
  if (res.ok) state.grants = res.data ?? []
  render()
}

// ---------- bootstrap & re-injection on turbo nav ----------

let lastHref = ''
let refreshInFlight: Promise<void> | null = null

async function refresh() {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = refreshImpl().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function refreshImpl() {
  const info = readPrPageInfo()
  state.info = info
  if (!info) return

  const userRes = await send<AuthUserPayload>({ type: 'AUTH_GET_USER' })
  if (userRes.ok && userRes.data?.user) {
    state.signedIn = true
    state.myLogin = userRes.data.githubLogin
  } else {
    state.signedIn = false
    state.myLogin = null
    render()
    return
  }

  if (!info.authorLogin) {
    state.error = 'Could not detect PR author from the page.'
    render()
    return
  }

  const prRes = await send<PrRow | null>({
    type: 'PR_GET_OR_CREATE',
    repo: info.repo,
    pr_number: info.prNumber,
    author_github_login: info.authorLogin
  })
  if (!prRes.ok) {
    state.error = prRes.error
    render()
    return
  }
  state.pr = prRes.data ?? null
  state.error = null

  if (state.pr?.status === 'distributed') {
    await refreshGrants()
  } else {
    state.grants = []
    render()
  }
}

function tick() {
  if (location.href !== lastHref) {
    lastHref = location.href
    document.getElementById(PANEL_ID)?.remove()
    state.pr = null
    state.grants = []
    state.participants = null
    state.draft = {}
    state.mode = 'view'
    state.error = null
    void refresh()
  } else if (!document.getElementById(PANEL_ID)) {
    render()
  }
}

void refresh()
new MutationObserver(tick).observe(document.body, { childList: true, subtree: true })

// sanity ping
send({ type: 'PING' })
  .then((r) => console.log('[pr-xp] bg says', r))
  .catch((err) => console.warn('[pr-xp] ping failed', err))
