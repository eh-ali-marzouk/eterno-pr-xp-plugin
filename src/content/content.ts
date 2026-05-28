import browser from 'webextension-polyfill'
import type {
  AuthUserPayload,
  GrantInput,
  GrantRow,
  Message,
  PrRow,
  Response,
  TeamRow
} from '../lib/messages'
import { readPrPageInfo } from './pr-page'
import { identiconSvgString } from '../lib/identicon'
import { iconSvg } from '../lib/pixel-icons'
import pixelCss from '../styles/pixel.css?inline'
import { version as PKG_VERSION } from '../../package.json'

const PANEL_VERSION = `v${PKG_VERSION}`
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
        if (parent.tagName === 'ASIDE' || parent.getAttribute('role') === 'complementary') return parent
        node = parent
      }
      return h.parentElement
    }
  }
  return null
}

// Walk up from a heading to find the section block that wraps it inside the
// sidebar (so we can insertBefore that block instead of just the heading).
function sectionBlockFor(heading: Element, sidebar: Element): Element | null {
  let node: Element | null = heading
  while (node && node.parentElement && node.parentElement !== sidebar) {
    node = node.parentElement
  }
  return node && node.parentElement === sidebar ? node : null
}

// Find a sibling inside the sidebar that corresponds to the Labels section
// so we can mount our card just above it. Falls back to Assignees if Labels
// isn't present, otherwise null (caller will append).
function findLabelsAnchor(sidebar: Element): Element | null {
  const want = /^(Labels|Assignees)$/i
  const candidates = sidebar.querySelectorAll(
    'h2, h3, .discussion-sidebar-heading, [class*="SidebarHeading"], [class*="sidebar-heading"]'
  )
  let labels: Element | null = null
  let assignees: Element | null = null
  for (const h of candidates) {
    const text = (h.textContent || '').trim()
    if (!want.test(text)) continue
    const block = sectionBlockFor(h, sidebar)
    if (!block) continue
    if (/^Labels$/i.test(text) && !labels) labels = block
    else if (/^Assignees$/i.test(text) && !assignees) assignees = block
  }
  return labels ?? assignees
}

async function send<T = unknown>(msg: Message): Promise<Response<T>> {
  return (await browser.runtime.sendMessage(msg)) as Response<T>
}

// ---------- shadow host setup ----------

const fontPressStartUrl = browser.runtime.getURL('src/assets/fonts/PressStart2P-Regular.woff2')
const fontVT323Url = browser.runtime.getURL('src/assets/fonts/VT323-Regular.woff2')

const FONT_FACE_CSS = `
@font-face { font-family: "Press Start 2P"; font-style: normal; font-weight: 400; font-display: swap; src: url("${fontPressStartUrl}") format("woff2"); }
@font-face { font-family: "VT323"; font-style: normal; font-weight: 400; font-display: swap; src: url("${fontVT323Url}") format("woff2"); }
`

const HOST_CSS = `
:host { all: initial; display: block; margin-top: 16px; font-family: var(--font-sys); color: var(--gh-text); }
.review-master-root { font-family: var(--font-sys); font-size: 13px; line-height: 1.4; color: var(--gh-text); }
.review-master-root * { box-sizing: border-box; }
.rm-label {
  font-family: var(--font-pixel);
  font-size: 9px;
  letter-spacing: 1px;
  color: var(--gh-text-mute);
  margin-bottom: 6px;
}
`

const FLOATING_HOST_CSS = `
:host { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; width: 320px; display: block; }
.rm-float-bar {
  display: flex; align-items: center; justify-content: space-between;
  gap: 8px; margin-bottom: 6px;
  font-family: var(--font-pixel); font-size: 8px; letter-spacing: 1px;
  color: var(--gh-text-mute);
}
.rm-float-bar button {
  appearance: none; border: 0; cursor: pointer;
  background: var(--gh-surface-2); color: var(--gh-text);
  font-family: var(--font-pixel); font-size: 8px; letter-spacing: 1px;
  padding: 4px 8px;
  box-shadow:
    0 -2px 0 0 var(--gh-border), 0 2px 0 0 var(--gh-border),
    -2px 0 0 0 var(--gh-border), 2px 0 0 0 var(--gh-border);
}
.rm-float-bar button:hover { filter: brightness(1.15); }
.rm-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 12px;
  background: var(--gh-surface);
  color: var(--gh-text);
  font-family: var(--font-pixel); font-size: 9px; letter-spacing: 1px;
  cursor: pointer;
  box-shadow:
    0 -3px 0 0 var(--gh-green), 0 3px 0 0 var(--gh-green),
    -3px 0 0 0 var(--gh-green), 3px 0 0 0 var(--gh-green),
    0 6px 0 0 #0a3318;
}
.rm-pill:hover { filter: brightness(1.1); }
:host(.rm-minimized) { width: auto; }
`

type PanelMode = 'view' | 'edit-pool' | 'distribute'

type PanelState = {
  signedIn: boolean
  myLogin: string | null
  info: ReturnType<typeof readPrPageInfo>
  pr: PrRow | null
  grants: GrantRow[]
  participants: string[] | null
  error: string | null
  busy: boolean
  mode: PanelMode
  draft: Record<string, number>
  isFloating: boolean
  minimized: boolean
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
  draft: {},
  isFloating: false,
  minimized: false
}

let shadowRoot: ShadowRoot | null = null

function ensurePanel(): HTMLElement | null {
  let host = document.getElementById(PANEL_ID) as HTMLElement | null
  if (host && host.shadowRoot) {
    shadowRoot = host.shadowRoot
    return host
  }
  if (host) host.remove()

  const sidebar = findSidebar()
  host = document.createElement('div')
  host.id = PANEL_ID
  state.isFloating = !sidebar

  if (sidebar) {
    const anchor = findLabelsAnchor(sidebar)
    if (anchor) sidebar.insertBefore(host, anchor)
    else sidebar.insertBefore(host, sidebar.firstChild)
  } else {
    document.body.appendChild(host)
  }

  shadowRoot = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = FONT_FACE_CSS + pixelCss + HOST_CSS + (state.isFloating ? FLOATING_HOST_CSS : '')
  shadowRoot.appendChild(style)

  const container = document.createElement('div')
  container.className = 'review-master-root'
  shadowRoot.appendChild(container)

  return host
}

function rootEl(): HTMLElement | null {
  if (!shadowRoot) return null
  return shadowRoot.querySelector('.review-master-root') as HTMLElement | null
}

// ---------- DOM helpers ----------

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue
    if (k === 'class') node.className = v as string
    else if (k === 'html') node.innerHTML = v as string
    else if (k === 'style' && typeof v === 'string') node.setAttribute('style', v)
    else (node as unknown as Record<string, unknown>)[k] = v
  }
  for (const c of children) node.append(c)
  return node
}

function avatarHtml(seed: string, variant?: string): string {
  const px = 22
  const cls = `pixel-avatar pixel-avatar--xs${variant ? ' pixel-avatar--' + variant : ''}`
  return `<span class="${cls}" style="width:${px}px;height:${px}px;padding:0">${identiconSvgString(seed, px)}</span>`
}

function cardShell(title: string, accent: string, children: (Node | string)[], titleColor?: string): HTMLElement {
  const fgOnAccent = titleColor ?? (accent.includes('gold') ? '#2b1d00' : accent.includes('purple') ? '#fff' : '#06160a')
  const card = el('div', {
    class: 'pixel-card',
    style: `--pc-border:${accent};padding:0`
  })
  card.appendChild(el('div', {
    style: `background:${accent};padding:8px 12px;display:flex;align-items:center;gap:8px;color:${fgOnAccent};font-family:var(--font-pixel);font-size:9px;letter-spacing:1px`,
    html: `${iconSvg('bolt', 12, fgOnAccent)}<span style="flex:1">${title}</span><span style="opacity:0.6;font-size:8px">${PANEL_VERSION}</span>`
  }))
  const body = el('div', { style: 'padding:12px' })
  for (const c of children) body.append(c)
  card.appendChild(body)
  return card
}

function readout(value: number | string, label: string, tone: 'green' | 'gold' | 'purple' = 'green', size = 'lg'): HTMLElement {
  const valStr = typeof value === 'number' ? String(value).padStart(XP_POOL_MAX.toString().length, '0') : value
  const cls = 'xp-readout' + (tone === 'gold' ? ' xp-readout--gold' : tone === 'purple' ? ' xp-readout--purple' : '') + (size === 'sm' ? ' xp-readout--sm' : '')
  return el('div', {
    class: 'pixel-inset scanlines',
    style: '--pi-bg:#05070a;padding:14px 12px;text-align:center;margin-bottom:12px',
    html: `
      <div style="font-family:var(--font-pixel);font-size:7px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:6px">${label}</div>
      <div class="${cls}">${valStr}<span style="font-size:0.55em;margin-left:4px;opacity:0.8">XP</span></div>
    `
  })
}

// ---------- render ----------

function render() {
  const host = ensurePanel()
  const root = rootEl()
  if (!root) return
  if (host) host.classList.toggle('rm-minimized', state.isFloating && state.minimized)
  root.replaceChildren()

  if (state.isFloating && state.minimized) {
    const pill = el('div', {
      class: 'rm-pill',
      html: `${iconSvg('bolt', 11, 'var(--xp-glow)')}<span>REVIEW-MASTER</span>`,
      title: 'Click to expand'
    })
    pill.addEventListener('click', () => { state.minimized = false; render() })
    root.appendChild(pill)
    return
  }

  if (state.isFloating) {
    const bar = el('div', { class: 'rm-float-bar' })
    bar.appendChild(el('span', { textContent: '↓ REVIEW-MASTER' }))
    const min = el('button', { textContent: '— MINIMIZE', title: 'Minimize panel' })
    min.addEventListener('click', () => { state.minimized = true; render() })
    bar.appendChild(min)
    root.appendChild(bar)
  } else {
    root.appendChild(el('div', { class: 'rm-label', textContent: '↓ REVIEW-MASTER' }))
  }
  root.appendChild(buildContent())
}

function buildContent(): DocumentFragment {
  const frag = document.createDocumentFragment()

  if (!state.info) {
    frag.appendChild(el('div', { style: 'color:var(--gh-text-mute);font-size:12px', textContent: 'Not a PR page' }))
    return frag
  }

  if (!state.signedIn) {
    frag.appendChild(cardShell('SIGN IN REQUIRED', 'var(--gh-border)', [
      el('div', {
        style: 'font-family:var(--font-mono);font-size:14px;color:var(--gh-text-mute);line-height:1.3',
        textContent: 'Sign in via the extension popup to use Review-Master.'
      })
    ]))
    return frag
  }

  if (state.error && !state.pr) {
    frag.appendChild(el('div', {
      style: 'color:var(--gh-red);font-family:var(--font-mono);font-size:14px;padding:6px 8px;background:rgba(248,81,73,0.08);border-left:3px solid var(--gh-red);margin-bottom:8px;word-break:break-word',
      textContent: state.error
    }))
  }

  const iAmAuthor = !!state.myLogin && state.myLogin === state.info.authorLogin
  const pr = state.pr
  const distributed = pr?.status === 'distributed'
  const merged = !!state.info.isMerged

  if (!pr) {
    if (iAmAuthor && !state.error) {
      frag.appendChild(cardShell('XP POOL', 'var(--gh-border)', [
        el('div', { class: 'blink', style: 'font-family:var(--font-pixel);font-size:9px;color:var(--gh-text-mute);text-align:center;padding:8px', textContent: 'LOADING…' })
      ]))
    } else if (!iAmAuthor) {
      frag.appendChild(cardShell('XP POOL', 'var(--gh-border)', [
        el('div', { style: 'font-family:var(--font-mono);font-size:14px;color:var(--gh-text-mute);text-align:center;padding:6px', textContent: 'No XP pool set yet.' })
      ]))
    }
    return frag
  }

  if (state.error && pr) {
    frag.appendChild(el('div', {
      style: 'color:var(--gh-red);font-family:var(--font-mono);font-size:14px;padding:6px 8px;background:rgba(248,81,73,0.08);border-left:3px solid var(--gh-red);margin-bottom:8px;word-break:break-word',
      textContent: state.error
    }))
  }

  // ---- distribute mode ----
  if (iAmAuthor && merged && !distributed && state.mode === 'distribute') {
    frag.appendChild(renderDistribute(pr))
    return frag
  }

  // ---- edit pool mode ----
  if (iAmAuthor && !distributed && state.mode === 'edit-pool') {
    frag.appendChild(renderEditPool(pr))
    return frag
  }

  // ---- distributed (post-merge) ----
  if (distributed) {
    if (iAmAuthor) frag.appendChild(renderAuthorDistributed(pr, state.grants))
    else frag.appendChild(renderReviewerWon(pr, state.grants))
    return frag
  }

  // ---- open / pre-distribute ----
  if (iAmAuthor) {
    frag.appendChild(renderAuthorOpen(pr, merged))
  } else {
    frag.appendChild(renderReviewerOpen(pr, merged))
  }

  return frag
}

function renderAuthorOpen(pr: PrRow, merged: boolean): HTMLElement {
  const title = merged ? 'XP POOL · READY TO DROP' : 'XP POOL · OPEN'
  const accent = merged ? 'var(--xp-gold)' : 'var(--gh-green)'
  const tone: 'green' | 'gold' = merged ? 'gold' : 'green'

  const children: HTMLElement[] = []
  children.push(readout(pr.xp_pool, merged ? 'POOL READY' : 'STAKE FOR REVIEWERS', tone))

  const editBtn = el('button', {
    class: 'pixel-btn pixel-btn--ghost pixel-btn--sm pixel-btn--block',
    style: 'margin-bottom:10px',
    html: `${iconSvg('pencil', 10, 'currentColor')}<span>EDIT POOL</span>`
  })
  if (merged) editBtn.setAttribute('disabled', '')
  else editBtn.addEventListener('click', () => { state.mode = 'edit-pool'; render() })
  children.push(editBtn)

  if (merged) {
    const distBtn = el('button', {
      class: 'pixel-btn pixel-btn--gold pixel-btn--block',
      html: `${iconSvg('chest', 11, '#2b1d00')}<span>DISTRIBUTE XP</span>`
    })
    distBtn.addEventListener('click', () => void startDistribute())
    children.push(distBtn)
  } else {
    children.push(el('div', {
      style: 'margin-top:6px;padding:8px 10px;background:rgba(63,185,80,0.08);border-left:3px solid var(--gh-green);font-family:var(--font-mono);font-size:14px;color:var(--gh-text);line-height:1.2',
      textContent: 'Distribute the pool when this PR merges.'
    }))
  }

  return cardShell(title, accent, children)
}

const XP_POOL_MAX = 500
const XP_POOL_STEP = 10

function renderEditPool(pr: PrRow): HTMLElement {
  const initial = Math.max(0, Math.min(XP_POOL_MAX, pr.xp_pool))
  let value = initial

  const readoutEl = el('div', {
    class: 'pixel-inset scanlines',
    style: '--pi-bg:#05070a;padding:14px 12px;text-align:center;margin-bottom:10px',
    html: `
      <div style="font-family:var(--font-pixel);font-size:7px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:6px">NEW POOL</div>
      <div class="xp-readout" id="rm-pool-readout">${String(value).padStart(XP_POOL_MAX.toString().length, '0')}<span style="font-size:0.55em;margin-left:4px;opacity:0.8">XP</span></div>
      <div style="font-family:var(--font-pixel);font-size:7px;letter-spacing:1px;color:var(--gh-text-dim);margin-top:4px">MAX ${XP_POOL_MAX}</div>
    `
  })
  const readoutNum = readoutEl.querySelector('#rm-pool-readout') as HTMLElement

  const slider = el('input', {
    type: 'range',
    min: '0',
    max: String(XP_POOL_MAX),
    step: String(XP_POOL_STEP),
    value: String(value),
    class: 'pixel-range',
    style: `--pr-pct:${(value / XP_POOL_MAX) * 100}%;--pr-fill:var(--xp-glow);margin-bottom:6px`
  }) as HTMLInputElement

  const ticks = el('div', {
    style: 'display:flex;justify-content:space-between;font-family:var(--font-pixel);font-size:7px;color:var(--gh-text-mute);margin-bottom:10px;padding:0 2px',
    html: '<span>0</span><span>250</span><span>500</span>'
  })

  slider.addEventListener('input', () => {
    value = Number(slider.value)
    readoutNum.innerHTML = `${String(value).padStart(XP_POOL_MAX.toString().length, '0')}<span style="font-size:0.55em;margin-left:4px;opacity:0.8">XP</span>`
    slider.style.setProperty('--pr-pct', `${(value / XP_POOL_MAX) * 100}%`)
  })

  const saveBtn = el('button', {
    class: 'pixel-btn pixel-btn--green pixel-btn--sm',
    textContent: 'SAVE'
  })
  saveBtn.addEventListener('click', async () => {
    state.busy = true
    state.error = null
    saveBtn.setAttribute('disabled', '')
    const res = await send<PrRow>({ type: 'PR_SET_POOL', pr_id: pr.id, xp_pool: value })
    state.busy = false
    if (!res.ok) { state.error = res.error; render(); return }
    state.pr = res.data ?? state.pr
    state.mode = 'view'
    render()
  })

  const cancelBtn = el('button', {
    class: 'pixel-btn pixel-btn--ghost pixel-btn--sm',
    textContent: 'CANCEL'
  })
  cancelBtn.addEventListener('click', () => { state.mode = 'view'; state.error = null; render() })

  return cardShell('SET XP POOL', 'var(--gh-green)', [
    readoutEl,
    el('div', {
      style: 'font-family:var(--font-pixel);font-size:8px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:6px',
      textContent: '◆ POOL SIZE'
    }),
    slider,
    ticks,
    el('div', { style: 'display:flex;gap:6px' }, [saveBtn, cancelBtn])
  ])
}

function renderReviewerOpen(pr: PrRow, merged: boolean): HTMLElement {
  const reviewers = state.participants ?? []
  const title = merged ? 'XP POOL · AWAITING DROP' : 'XP POOL · UP FOR GRABS'
  const accent = merged ? 'var(--xp-gold)' : 'var(--gh-green)'
  const blurb = merged
    ? 'PR merged. Your share unlocks when the author distributes the pool.'
    : 'Your share unlocks when the author merges & distributes.'
  const blinkText = merged ? '◇ AWAITING DISTRIBUTION ◇' : '◇ AWAITING MERGE ◇'

  const children: HTMLElement[] = []
  children.push(readout(pr.xp_pool, merged ? 'POOL LOCKED IN' : 'ON THE LINE', merged ? 'gold' : 'green'))

  children.push(el('div', {
    style: 'padding:8px 10px;margin-bottom:12px;background:rgba(241,196,15,0.08);border-left:3px solid var(--xp-gold);font-family:var(--font-mono);font-size:15px;color:var(--gh-text);line-height:1.15',
    textContent: blurb
  }))

  if (reviewers.length > 0) {
    children.push(el('div', {
      style: 'font-family:var(--font-pixel);font-size:8px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:8px',
      textContent: '◆ COMPETING REVIEWERS'
    }))
    const list = el('div', { style: 'display:flex;flex-direction:column;gap:6px' })
    for (const login of reviewers) {
      const isYou = login === state.myLogin
      list.appendChild(el('div', {
        style: 'display:flex;align-items:center;gap:8px',
        html: `
          ${avatarHtml(login, isYou ? 'green' : undefined)}
          <span style="font-size:12px;color:var(--gh-text)">@${login}</span>
          ${isYou ? '<span style="font-family:var(--font-pixel);font-size:7px;color:var(--gh-green)">← YOU</span>' : ''}
          <span style="margin-left:auto;font-family:var(--font-pixel);font-size:7px;color:var(--gh-text-mute)">PENDING</span>
        `
      }))
    }
    children.push(list)
  }

  children.push(el('div', {
    class: 'blink',
    style: `margin-top:12px;display:flex;align-items:center;justify-content:center;gap:6px;padding:8px;font-family:var(--font-pixel);font-size:8px;color:${merged ? 'var(--xp-gold)' : 'var(--gh-yellow)'};background:rgba(0,0,0,0.25)`,
    textContent: blinkText
  }))

  return cardShell(title, accent, children)
}

function renderAuthorDistributed(pr: PrRow, grants: GrantRow[]): HTMLElement {
  const children: HTMLElement[] = []
  children.push(el('div', {
    class: 'pixel-inset',
    style: '--pi-bg:#0a0e14;padding:10px;text-align:center;margin-bottom:12px',
    html: `
      <div style="font-family:var(--font-pixel);font-size:7px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:4px">POOL DEPLOYED</div>
      <div class="xp-readout xp-readout--purple" style="font-size:22px">${String(pr.xp_pool).padStart(XP_POOL_MAX.toString().length, '0')}<span style="font-size:0.55em;margin-left:4px;opacity:0.8">XP</span></div>
    `
  }))

  children.push(el('div', {
    style: 'font-family:var(--font-pixel);font-size:8px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:8px',
    textContent: '◆ AWARDED TO'
  }))

  const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' })
  for (const g of grants) {
    const row = el('div', {})
    row.appendChild(el('div', {
      style: 'display:flex;align-items:center;gap:8px;margin-bottom:3px',
      html: `
        ${avatarHtml(g.recipient_github_login)}
        <span style="font-size:12px;color:var(--gh-text)">@${g.recipient_github_login}</span>
        <span style="margin-left:auto;font-family:var(--font-pixel);font-size:9px;color:var(--xp-gold)">+${g.points}</span>
        <span style="font-family:var(--font-pixel);font-size:9px;color:var(--gh-text-mute);min-width:32px;text-align:right">${g.percentage}%</span>
      `
    }))
    row.appendChild(el('div', {
      class: 'pixel-bar',
      style: `--pb-fill:var(--gh-purple);--pb-pct:${g.percentage}%;height:8px`
    }))
    list.appendChild(row)
  }
  children.push(list)

  children.push(el('div', {
    style: 'margin-top:12px;padding:6px 10px;display:flex;align-items:center;gap:6px;font-family:var(--font-pixel);font-size:8px;color:var(--gh-purple);background:rgba(163,113,247,0.1)',
    html: `${iconSvg('check', 10, 'var(--gh-purple)')}<span>DISTRIBUTED</span>`
  }))

  return cardShell('XP DISTRIBUTED', 'var(--gh-purple)', children, '#fff')
}

function renderReviewerWon(pr: PrRow, grants: GrantRow[]): HTMLElement {
  const mine = state.myLogin ? grants.find(g => g.recipient_github_login === state.myLogin) : undefined

  if (!mine) {
    // Not a recipient — show a quiet distributed summary.
    return renderAuthorDistributed(pr, grants)
  }

  const children: HTMLElement[] = []
  children.push(el('div', {
    class: 'pixel-inset scanlines',
    style: '--pi-bg:#0a0e14;padding:12px;text-align:center;margin-bottom:12px',
    html: `
      <div style="font-family:var(--font-pixel);font-size:7px;letter-spacing:1px;color:var(--xp-gold);margin-bottom:6px">★ YOUR HAUL ★</div>
      <div class="xp-readout xp-readout--gold bob" style="font-size:32px">+${String(mine.points).padStart(3, '0')}<span style="font-size:0.55em;margin-left:4px">XP</span></div>
      <div style="font-family:var(--font-pixel);font-size:8px;letter-spacing:1px;color:var(--gh-text-mute);margin-top:4px">${mine.percentage}% OF ${pr.xp_pool} POOL</div>
    `
  }))

  children.push(el('div', {
    style: 'font-family:var(--font-pixel);font-size:8px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:8px',
    textContent: '◆ FINAL SPLIT'
  }))

  const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' })
  for (const g of grants) {
    const isYou = g.recipient_github_login === state.myLogin
    const row = el('div', {})
    row.appendChild(el('div', {
      style: 'display:flex;align-items:center;gap:8px;margin-bottom:3px',
      html: `
        ${avatarHtml(g.recipient_github_login, isYou ? 'gold' : undefined)}
        <span style="font-size:12px;color:${isYou ? 'var(--xp-gold)' : 'var(--gh-text)'}">@${g.recipient_github_login}${isYou ? '  (you)' : ''}</span>
        <span style="margin-left:auto;font-family:var(--font-pixel);font-size:9px;color:var(--gh-text)">${g.points} XP · ${g.percentage}%</span>
      `
    }))
    row.appendChild(el('div', {
      class: 'pixel-bar',
      style: `--pb-fill:${isYou ? 'var(--xp-gold)' : 'var(--gh-green)'};--pb-pct:${g.percentage}%;height:10px`
    }))
    list.appendChild(row)
  }
  children.push(list)

  children.push(el('div', {
    style: 'margin-top:12px;padding:8px;background:rgba(63,185,80,0.08);font-family:var(--font-mono);font-size:15px;color:var(--gh-green);text-align:center;line-height:1.1;display:flex;align-items:center;justify-content:center;gap:6px',
    html: `${iconSvg('check', 11, 'var(--gh-green)')}<span>Added to your career total.</span>`
  }))

  return cardShell('XP CLAIMED · WIN', 'var(--xp-gold)', children)
}

// ---------- distribute flow ----------

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
  if (!res.ok) { state.error = res.error; state.mode = 'view'; render(); return }
  state.participants = res.data ?? []
  state.draft = {}
  if (state.participants.length > 0) {
    const even = Math.floor(100 / state.participants.length)
    let remainder = 100 - even * state.participants.length
    for (const p of state.participants) {
      state.draft[p] = even + (remainder-- > 0 ? 1 : 0)
    }
  }
  render()
}

function renderDistribute(pr: PrRow): HTMLElement {
  const participants = state.participants ?? []
  const children: HTMLElement[] = []
  children.push(readout(pr.xp_pool, 'POOL READY', 'gold'))

  if (state.participants === null) {
    children.push(el('div', { class: 'blink', style: 'text-align:center;font-family:var(--font-pixel);font-size:9px;color:var(--gh-text-mute);padding:8px', textContent: 'FETCHING REVIEWERS…' }))
    return cardShell('XP POOL · READY TO DROP', 'var(--xp-gold)', children)
  }

  if (participants.length === 0) {
    children.push(el('div', {
      style: 'font-family:var(--font-mono);font-size:14px;color:var(--gh-text-mute);text-align:center;padding:8px',
      textContent: 'No reviewers or commenters found.'
    }))
    const cancel = el('button', { class: 'pixel-btn pixel-btn--ghost pixel-btn--sm pixel-btn--block', textContent: 'CANCEL' })
    cancel.addEventListener('click', () => { state.mode = 'view'; render() })
    children.push(cancel)
    return cardShell('XP POOL · READY TO DROP', 'var(--xp-gold)', children)
  }

  const total = () => Object.values(state.draft).reduce((a, b) => a + b, 0)
  const headerLabel = el('div', {
    style: 'font-family:var(--font-pixel);font-size:8px;letter-spacing:1px;color:var(--gh-text-mute);margin-bottom:8px;display:flex;justify-content:space-between;align-items:center'
  })
  const updateHeader = () => {
    const sum = total()
    const ok = sum === 100
    headerLabel.innerHTML = `<span>◆ DISTRIBUTION</span><span style="color:${ok ? 'var(--gh-green)' : 'var(--gh-red)'}">${sum}% / 100%</span>`
  }
  updateHeader()
  children.push(headerLabel)

  const rows = el('div', { style: 'display:flex;flex-direction:column;gap:12px;margin-bottom:12px' })

  const rowRefs: Record<string, { slider: HTMLInputElement; num: HTMLInputElement; amount: HTMLSpanElement }> = {}
  let submitBtn: HTMLButtonElement | null = null

  const refreshSubmit = () => {
    if (!submitBtn) return
    submitBtn.disabled = total() !== 100 || state.busy
  }
  const setShare = (login: string, val: number) => {
    const v = Math.max(0, Math.min(100, Math.round(val)))
    state.draft[login] = v
    const ref = rowRefs[login]
    if (ref) {
      ref.slider.value = String(v)
      ref.slider.style.setProperty('--pr-pct', v + '%')
      ref.num.value = String(v)
      ref.amount.textContent = `+${Math.round(pr.xp_pool * v / 100)} XP`
    }
    updateHeader()
    refreshSubmit()
  }

  for (const login of participants) {
    const pct = state.draft[login] ?? 0
    const row = el('div', {})
    const head = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px' })
    head.innerHTML = `
      ${avatarHtml(login)}
      <span style="font-size:12px;flex:1">@${login}</span>
      <span class="amt" style="font-family:var(--font-pixel);font-size:9px;color:var(--xp-gold);min-width:64px;text-align:right">+${Math.round(pr.xp_pool * pct / 100)} XP</span>
      <span class="pctlbl" style="font-family:var(--font-pixel);font-size:9px;color:var(--gh-text);min-width:32px;text-align:right">${pct}%</span>
    `
    const slider = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      class: 'pixel-range',
      value: String(pct),
      style: `--pr-pct:${pct}%;--pr-fill:var(--xp-gold)`
    }) as HTMLInputElement
    const num = el('input', {
      type: 'number',
      min: '0',
      max: '100',
      value: String(pct),
      class: 'pixel-input pixel-input--sm',
      style: 'width:64px;margin-top:4px;display:none'
    }) as HTMLInputElement
    const amountSpan = head.querySelector('.amt') as HTMLSpanElement
    const pctLbl = head.querySelector('.pctlbl') as HTMLSpanElement
    rowRefs[login] = { slider, num, amount: amountSpan }

    slider.addEventListener('input', () => {
      const v = Number(slider.value)
      state.draft[login] = v
      slider.style.setProperty('--pr-pct', v + '%')
      pctLbl.textContent = `${v}%`
      amountSpan.textContent = `+${Math.round(pr.xp_pool * v / 100)} XP`
      num.value = String(v)
      updateHeader()
      refreshSubmit()
    })
    num.addEventListener('input', () => setShare(login, Number(num.value)))

    row.appendChild(head)
    row.appendChild(slider)
    rows.appendChild(row)
  }
  children.push(rows)

  const evenBtn = el('button', { class: 'pixel-btn pixel-btn--ghost pixel-btn--sm', html: `${iconSvg('refresh', 10, 'currentColor')}<span>EVEN</span>` })
  evenBtn.addEventListener('click', () => {
    const n = participants.length
    const base = Math.floor(100 / n)
    let rem = 100 - base * n
    for (const p of participants) setShare(p, base + (rem-- > 0 ? 1 : 0))
  })

  submitBtn = el('button', {
    class: 'pixel-btn pixel-btn--gold pixel-btn--block',
    html: `${iconSvg('chest', 11, '#2b1d00')}<span>DROP THE LOOT</span>`
  }) as HTMLButtonElement
  submitBtn.addEventListener('click', async () => {
    const grants: GrantInput[] = Object.entries(state.draft)
      .filter(([, pct]) => pct > 0)
      .map(([login, pct]) => ({ recipient_github_login: login, percentage: pct }))
    state.busy = true
    state.error = null
    submitBtn!.setAttribute('disabled', '')
    const res = await send<PrRow>({
      type: 'PR_DISTRIBUTE',
      pr_id: pr.id,
      xp_pool: pr.xp_pool,
      grants
    })
    state.busy = false
    if (!res.ok) { state.error = res.error; render(); return }
    state.pr = res.data ?? state.pr
    state.mode = 'view'
    const droppedPool = pr.xp_pool
    const droppedGrants = grants.map((g) => ({
      login: g.recipient_github_login,
      pct: g.percentage,
      points: Math.round((droppedPool * g.percentage) / 100)
    }))
    state.participants = null
    state.draft = {}
    playLootDrop(droppedPool, droppedGrants)
    await refreshGrants()
  })
  refreshSubmit()

  const cancelBtn = el('button', { class: 'pixel-btn pixel-btn--ghost pixel-btn--sm', textContent: 'CANCEL' })
  cancelBtn.addEventListener('click', () => {
    state.mode = 'view'
    state.participants = null
    state.draft = {}
    state.error = null
    render()
  })

  children.push(el('div', { style: 'display:flex;gap:6px;align-items:stretch' }, [evenBtn, submitBtn]))
  children.push(el('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [cancelBtn]))

  return cardShell('XP POOL · READY TO DROP', 'var(--xp-gold)', children)
}

async function refreshGrants() {
  if (!state.pr) return
  const res = await send<GrantRow[]>({ type: 'PR_LIST_GRANTS', pr_id: state.pr.id })
  if (res.ok) state.grants = res.data ?? []
  render()
}

// ---------- loot-drop celebration ----------

const CELEBRATION_HOST_ID = 'review-master-celebration'

const CELEBRATION_CSS = `
:host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: auto; }
.cel-root {
  position: fixed; inset: 0;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.78);
  overflow: hidden;
  animation: cel-fade-in .25s steps(4, end) both;
  font-family: var(--font-pixel);
}
.cel-rays {
  position: absolute; inset: -25%;
  background: repeating-conic-gradient(
    from 0deg,
    rgba(184,134,11,0.55) 0deg 15deg,
    transparent       15deg 30deg
  );
  animation: cel-spin 8s linear infinite;
  filter: drop-shadow(0 0 12px rgba(241,196,15,0.35));
}
.cel-panel {
  position: relative;
  width: min(86%, 420px);
  background: var(--xp-gold);
  color: #2b1d00;
  padding: 0;
  box-shadow:
    0 -4px 0 0 var(--xp-gold-2),
    0 4px 0 0 var(--xp-gold-2),
    -4px 0 0 0 var(--xp-gold-2),
    4px 0 0 0 var(--xp-gold-2),
    0 12px 0 0 rgba(0,0,0,0.45);
  animation: cel-pop .35s steps(5, end) both;
}
.cel-panel-bar {
  padding: 10px 14px;
  font-size: 11px; letter-spacing: 1.5px;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  color: #2b1d00;
}
.cel-screen {
  margin: 0 12px 12px;
  background: #0a0e14;
  padding: 18px 12px 14px;
  text-align: center;
  box-shadow:
    0 -3px 0 0 #2b1d00,
    0 3px 0 0 #2b1d00,
    -3px 0 0 0 #2b1d00,
    3px 0 0 0 #2b1d00;
  position: relative;
  overflow: hidden;
}
.cel-screen::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 2px, rgba(0,0,0,0.25) 2px 3px);
  mix-blend-mode: multiply;
}
.cel-amount {
  font-family: var(--font-pixel);
  font-size: 44px;
  color: var(--xp-gold);
  letter-spacing: 3px;
  text-shadow:
    0 0 8px rgba(241,196,15,0.7),
    0 0 18px rgba(241,196,15,0.4),
    4px 4px 0 rgba(0,0,0,0.6);
  animation: cel-bob 0.9s steps(4, end) infinite;
}
.cel-amount span { font-size: 0.5em; margin-left: 6px; opacity: 0.9; }
.cel-caption {
  margin-top: 8px;
  font-family: var(--font-pixel);
  font-size: 8px;
  letter-spacing: 1.5px;
  color: var(--gh-text-mute);
}
.cel-recipients {
  display: flex; justify-content: center; gap: 14px;
  padding: 4px 10px 14px;
}
.cel-recipient { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.cel-recipient .av {
  width: 36px; height: 36px;
  background: var(--gh-bg);
  display: inline-flex; align-items: center; justify-content: center;
  box-shadow:
    0 -3px 0 0 #2b1d00, 0 3px 0 0 #2b1d00,
    -3px 0 0 0 #2b1d00, 3px 0 0 0 #2b1d00;
}
.cel-recipient .pts {
  font-family: var(--font-pixel); font-size: 9px;
  color: var(--xp-glow);
  text-shadow: 0 0 6px rgba(110,226,102,0.6), 2px 2px 0 rgba(0,0,0,0.5);
}
.cel-recipient .pct {
  font-family: var(--font-pixel); font-size: 7px;
  color: #2b1d00; opacity: 0.7;
}
.cel-confetti {
  position: absolute; pointer-events: none;
  width: 10px; height: 10px;
  top: -20px;
  animation-name: cel-fall;
  animation-timing-function: linear;
  animation-iteration-count: 1;
}
.cel-close-hint {
  position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%);
  font-family: var(--font-pixel); font-size: 8px; letter-spacing: 1px;
  color: rgba(255,255,255,0.6);
  animation: cel-blink 1.1s steps(2, end) infinite;
}
@keyframes cel-spin { to { transform: rotate(360deg); } }
@keyframes cel-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes cel-pop {
  0% { transform: scale(0.4); opacity: 0; }
  60% { transform: scale(1.06); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}
@keyframes cel-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes cel-blink { 0%,60% { opacity: 1; } 61%,100% { opacity: 0.4; } }
@keyframes cel-fall {
  0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; }
  100% { transform: translate3d(var(--cdx, 0), 110vh, 0) rotate(var(--crot, 720deg)); opacity: 0.9; }
}
`

const CONFETTI_COLORS = ['#f1c40f', '#79c0ff', '#f778ba', '#3fb950', '#a371f7']

function playLootDrop(pool: number, grants: { login: string; pct: number; points: number }[]) {
  // If a previous celebration is still on screen, replace it.
  document.getElementById(CELEBRATION_HOST_ID)?.remove()

  const host = document.createElement('div')
  host.id = CELEBRATION_HOST_ID
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = FONT_FACE_CSS + pixelCss + CELEBRATION_CSS
  shadow.appendChild(style)

  const root = document.createElement('div')
  root.className = 'cel-root'
  shadow.appendChild(root)

  // Rotating sun-rays
  const rays = document.createElement('div')
  rays.className = 'cel-rays'
  root.appendChild(rays)

  // Confetti
  const COUNT = 28
  for (let i = 0; i < COUNT; i++) {
    const c = document.createElement('div')
    c.className = 'cel-confetti'
    const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]
    const leftPct = Math.random() * 100
    const dx = (Math.random() * 200 - 100) + 'px'
    const rot = (Math.random() * 1080 - 360) + 'deg'
    const dur = (1.6 + Math.random() * 1.6).toFixed(2) + 's'
    const delay = (Math.random() * 0.4).toFixed(2) + 's'
    c.style.cssText = `left:${leftPct}%;background:${color};animation-duration:${dur};animation-delay:${delay};--cdx:${dx};--crot:${rot};`
    root.appendChild(c)
  }

  // Center panel
  const panel = document.createElement('div')
  panel.className = 'cel-panel'
  panel.innerHTML = `
    <div class="cel-panel-bar"><span>◆</span><span>LOOT DROP</span><span>◆</span></div>
    <div class="cel-screen">
      <div class="cel-amount">+${pool}<span>XP</span></div>
      <div class="cel-caption">SPLIT ACROSS ${grants.length} REVIEWER${grants.length === 1 ? '' : 'S'}</div>
    </div>
    <div class="cel-recipients">
      ${grants.map((g) => `
        <div class="cel-recipient">
          <span class="av">${identiconSvgString(g.login, 36)}</span>
          <span class="pts">+${g.points}</span>
          <span class="pct">${g.pct}%</span>
        </div>
      `).join('')}
    </div>
  `
  root.appendChild(panel)

  // Close hint
  const hint = document.createElement('div')
  hint.className = 'cel-close-hint'
  hint.textContent = '▸ CLICK TO CLOSE ◂'
  root.appendChild(hint)

  // Dismiss handlers
  const dismiss = () => host.remove()
  root.addEventListener('click', dismiss)
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey)
      dismiss()
    }
  })
  setTimeout(dismiss, 4500)
}

// ---------- bootstrap & turbo-nav re-injection ----------

let lastHref = ''
let refreshInFlight: Promise<void> | null = null

async function refresh() {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = refreshImpl().finally(() => { refreshInFlight = null })
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

  // Latch this author's team server-side before the PR insert. A brand-new
  // author whose profiles.team_id is null must be resolved first, or the
  // insert's RLS check fails. We don't need the result — just don't crash.
  await send<TeamRow | null>({ type: 'TEAM_RESOLVE' }).catch(() => undefined)

  const prRes = await send<PrRow | null>({
    type: 'PR_GET_OR_CREATE',
    repo: info.repo,
    pr_number: info.prNumber,
    author_github_login: info.authorLogin
  })
  if (!prRes.ok) { state.error = prRes.error; render(); return }
  state.pr = prRes.data ?? null
  state.error = null

  if (state.pr?.status === 'distributed') {
    await refreshGrants()
  } else {
    state.grants = []
    render()
  }
}

let lastMerged: boolean | null = null

function tick() {
  if (location.href !== lastHref) {
    lastHref = location.href
    lastMerged = null
    document.getElementById(PANEL_ID)?.remove()
    shadowRoot = null
    state.pr = null
    state.grants = []
    state.participants = null
    state.draft = {}
    state.mode = 'view'
    state.error = null
    void refresh()
    return
  }

  if (!document.getElementById(PANEL_ID)) {
    render()
  }

  // Detect when GitHub itself flips the PR's merged state in the DOM
  // (e.g. user merges in another tab, or someone else merges while
  // we're viewing). Re-fetch so the card moves from "up for grabs" →
  // "awaiting drop" without a hard reload.
  const info = readPrPageInfo()
  if (info) {
    const merged = !!info.isMerged
    if (lastMerged !== null && lastMerged !== merged) void refresh()
    lastMerged = merged
  }
}

void refresh()
new MutationObserver(tick).observe(document.body, { childList: true, subtree: true })

// Re-fetch when the user returns to the tab — backend state (someone
// distributing XP, pool edits) won't reflect in the DOM, so the only
// way to learn about it without spamming the network is to poll on
// signals that mean "the user is looking at this".
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.mode === 'view') {
    void refresh()
  }
})

// Light heartbeat poll while the tab is visible and the user isn't
// mid-edit. Catches the case where a teammate distributes XP to the
// current viewer mid-session.
const POLL_INTERVAL_MS = 45_000
setInterval(() => {
  if (document.visibilityState !== 'visible') return
  if (state.mode !== 'view') return
  void refresh()
}, POLL_INTERVAL_MS)

send({ type: 'PING' })
  .then((r) => console.log('[review-master] bg says', r))
  .catch((err) => console.warn('[review-master] ping failed', err))
