import browser from 'webextension-polyfill'
import type {
  AuthUserPayload,
  LeaderboardRow,
  Message,
  Response,
  TeamRow
} from '../lib/messages'
import { identiconSvgString } from '../lib/identicon'
import { iconSvg } from '../lib/pixel-icons'
import { version as PKG_VERSION } from '../../package.json'

const POPUP_VERSION = `v${PKG_VERSION}`
const LB_TOP_N = 10

type View = 'connect' | 'profile' | 'leaderboard'

type State = {
  view: View
  signedIn: boolean
  myLogin: string | null
  authError: string | null
  busy: boolean
  // profile
  totalXp: number | null
  rank: number | null
  // leaderboard
  board: LeaderboardRow[] | null
  boardError: string | null
  // team
  team: TeamRow | null
}

const state: State = {
  view: 'connect',
  signedIn: false,
  myLogin: null,
  authError: null,
  busy: false,
  totalXp: null,
  rank: null,
  board: null,
  boardError: null,
  team: null
}

const root = document.getElementById('popup-root') as HTMLDivElement

async function send<T = unknown>(msg: Message): Promise<Response<T>> {
  return (await browser.runtime.sendMessage(msg)) as Response<T>
}

// ---------- helpers ----------

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

function avatarHtml(seed: string, size: 'xs' | 'sm' | 'md' | 'lg', variant?: string): string {
  const px = size === 'xs' ? 22 : size === 'sm' ? 28 : size === 'lg' ? 56 : 40
  const cls = `pixel-avatar${size === 'xs' ? ' pixel-avatar--xs' : size === 'sm' ? ' pixel-avatar--sm' : ''}${variant ? ' pixel-avatar--' + variant : ''}`
  return `<span class="${cls}" style="width:${px}px;height:${px}px;padding:0">${identiconSvgString(seed, px)}</span>`
}

function brandBar(): HTMLElement {
  return el('div', {
    class: 'brand-bar',
    html: `
      <div class="logo">${iconSvg('bolt', 12, '#06160a')}</div>
      <div class="wordmark">REVIEW<span class="dot">·</span><span class="dot">MASTER</span></div>
      <div class="ver">${POPUP_VERSION}</div>
    `
  })
}

function tabStrip(): HTMLElement {
  const tabs = el('div', { class: 'tab-strip' })
  const mkTab = (id: 'profile' | 'leaderboard', label: string, icon: string) => {
    const btn = el('button', {
      class: 'tab' + (state.view === id ? ' active' : ''),
      html: `${icon}<span>${label}</span>`
    })
    btn.addEventListener('click', () => {
      state.view = id
      render()
      if (id === 'leaderboard' && !state.board) void loadLeaderboard()
    })
    return btn
  }
  tabs.append(
    mkTab('profile', 'PROFILE', iconSvg('bolt', 9, 'currentColor')),
    mkTab('leaderboard', 'LEADERBOARD', iconSvg('crown', 9, 'currentColor'))
  )
  return tabs
}

// ---------- views ----------

function renderConnect(): HTMLElement {
  const wrap = el('div', { class: 'connect' })

  wrap.appendChild(el('div', {
    class: 'pixel-card scanlines hero',
    html: `<div class="bob">${iconSvg('bolt', 64, 'var(--xp-glow)')}</div>`
  }))

  wrap.appendChild(el('div', {
    html: `
      <div class="wordmark-1">REVIEW</div>
      <div class="wordmark-2">MASTER</div>
      <div class="tagline">Turn pull-request reviews into XP. Stake. Distribute. Climb the board.</div>
    `
  }))

  const actions = el('div', { class: 'actions' })
  const btn = el('button', {
    class: 'pixel-btn pixel-btn--green pixel-btn--lg pixel-btn--block',
    html: `${iconSvg('github', 14, '#06160a')}<span>CONNECT TO GITHUB</span>`
  })
  btn.addEventListener('click', onSignIn)
  if (state.busy) btn.setAttribute('disabled', '')
  actions.appendChild(btn)
  actions.appendChild(el('div', {
    class: 'lock-hint',
    html: `${iconSvg('lock', 9, 'var(--gh-text-dim)')}<span>READ-ONLY · OAUTH · NO WRITES</span>`
  }))
  wrap.appendChild(actions)

  wrap.appendChild(el('div', { class: 'press-start blink', textContent: '▸ PRESS START ◂' }))

  if (state.authError) {
    wrap.appendChild(el('div', { class: 'error-banner', textContent: state.authError }))
  }

  return wrap
}

function renderProfile(): HTMLElement {
  const wrap = el('div', { class: 'profile' })

  // Hero
  const hero = el('div', { class: 'pixel-card hero-card' })
  const rankStr = state.rank ? `GLOBAL #${state.rank}` : 'UNRANKED'
  hero.appendChild(el('div', {
    class: 'hero-bar',
    html: `<span>◆ PLAYER 1</span><span>${rankStr}</span>`
  }))

  const heroBody = el('div', { class: 'hero-body' })
  const seed = state.myLogin ?? 'anon'
  heroBody.appendChild(el('div', { html: avatarHtml(seed, 'lg', 'green') }))
  const info = el('div', { style: 'flex:1;min-width:0' })
  info.appendChild(el('div', { class: 'login', textContent: '@' + (state.myLogin ?? '—') }))
  info.appendChild(el('div', { class: 'joined', textContent: 'Signed in via GitHub' }))
  heroBody.appendChild(info)
  hero.appendChild(heroBody)

  const xpBlock = el('div', { class: 'pixel-inset scanlines xp-block' })
  xpBlock.appendChild(el('div', { class: 'label', textContent: 'TOTAL XP' }))
  const xpVal = state.totalXp ?? 0
  xpBlock.appendChild(el('div', {
    class: 'xp-readout value',
    html: `${xpVal.toLocaleString()}<span class="unit">XP</span>`
  }))
  hero.appendChild(xpBlock)

  wrap.appendChild(hero)

  // Sign out
  const signOut = el('button', {
    class: 'pixel-btn pixel-btn--ghost pixel-btn--sm pixel-btn--block',
    textContent: 'SIGN OUT'
  })
  signOut.addEventListener('click', onSignOut)
  if (state.busy) signOut.setAttribute('disabled', '')
  wrap.appendChild(signOut)

  if (state.authError) {
    wrap.appendChild(el('div', { class: 'error-banner', textContent: state.authError }))
  }

  return wrap
}


function renderLeaderboard(): HTMLElement {
  const wrap = el('div', { class: 'lb' })

  const header = el('div', { class: 'lb-header' })
  const headerTitle = state.team ? `${state.team.name} — GLOBAL TOP 100` : 'GLOBAL TOP 100'
  header.appendChild(el('div', { class: 'pixel-title-lg', style: 'font-size:11px', textContent: headerTitle }))
  header.appendChild(el('span', { class: 'pixel-pill', style: 'margin-left:auto', textContent: 'ALL TIME' }))
  wrap.appendChild(header)

  if (!state.team) {
    wrap.appendChild(el('div', {
      class: 'hint',
      style: 'color:var(--gh-text-dim)',
      textContent: 'Open any PR in your org to activate your team.'
    }))
  }

  const body = el('div', { class: 'lb-body' })

  if (state.boardError) {
    body.appendChild(el('div', { class: 'error-banner', textContent: state.boardError }))
    wrap.appendChild(body)
    return wrap
  }
  if (state.board === null) {
    body.appendChild(el('div', { class: 'lb-status blink', textContent: 'LOADING…' }))
    wrap.appendChild(body)
    return wrap
  }
  if (state.board.length === 0) {
    body.appendChild(el('div', { class: 'lb-status', textContent: 'NO XP AWARDED YET.' }))
    wrap.appendChild(body)
    return wrap
  }

  const board = state.board
  const top3 = board.slice(0, 3)
  // Podium: silver (2), gold (1), bronze (3)
  if (top3.length >= 1) {
    const podium = el('div', { class: 'lb-podium' })
    const heights = [90, 110, 76]
    const colors = ['silver', 'gold', 'bronze']
    const bgs = ['#a8b3bd', 'var(--xp-gold)', '#c97a3a']
    const order = [1, 0, 2] // visual columns L → R
    order.forEach((idx, col) => {
      const p = top3[idx]
      if (!p) return
      const rank = idx + 1
      const colEl = el('div', { class: 'lb-podium-col' })
      colEl.appendChild(el('div', {
        html: avatarHtml(p.recipient_github_login, rank === 1 ? 'md' : 'sm', colors[col])
      }))
      colEl.appendChild(el('div', { class: 'name', textContent: '@' + p.recipient_github_login }))
      colEl.appendChild(el('div', {
        class: 'plinth',
        style: `height:${heights[col]}px;background:${bgs[col]}`,
        html: `<div class="rank">${rank}</div><div class="xp">${p.total.toLocaleString()}</div>`
      }))
      podium.appendChild(colEl)
    })
    body.appendChild(podium)
  }

  // Slice for the list 4..N
  const myIdx = state.myLogin ? board.findIndex(r => r.recipient_github_login === state.myLogin) : -1
  const rest = board.slice(3, LB_TOP_N)

  const list = el('div', { class: 'pixel-card lb-list' })
  rest.forEach((p, i) => {
    const rank = i + 4
    const row = el('div', {
      class: 'lb-row row-hover',
      html: `
        <div class="rank">${String(rank).padStart(2, '0')}</div>
        ${avatarHtml(p.recipient_github_login, 'xs')}
        <div class="name">@${p.recipient_github_login}</div>
        <div class="xp">${p.total.toLocaleString()}</div>
      `
    })
    list.appendChild(row)
  })

  // Divider + sticky you
  const youInTop = myIdx >= 0 && myIdx < LB_TOP_N
  if (state.myLogin && !youInTop) {
    const youRow = myIdx >= 0 ? board[myIdx] : null
    const skipped = myIdx >= 0 ? myIdx - LB_TOP_N : 0
    if (skipped > 0) {
      list.appendChild(el('div', {
        class: 'lb-divider',
        textContent: `· · · ${skipped} MORE · · ·`
      }))
    } else if (myIdx < 0) {
      // user not on board at all — still show their zero row
      list.appendChild(el('div', { class: 'lb-divider', textContent: '· · · UNRANKED · · ·' }))
    }
    const youData = youRow ?? { recipient_github_login: state.myLogin, total: 0 }
    const youEl = el('div', {
      class: 'lb-you',
      html: `
        <div class="rank">${myIdx >= 0 ? String(myIdx + 1).padStart(2, '0') : '—'}</div>
        ${avatarHtml(youData.recipient_github_login, 'xs', 'green')}
        <div class="name">@${youData.recipient_github_login}<span class="tag">← YOU</span></div>
        <div class="xp">${youData.total.toLocaleString()}</div>
      `
    })
    list.appendChild(youEl)
  }

  body.appendChild(list)
  wrap.appendChild(body)
  return wrap
}

// ---------- top-level render ----------

function render() {
  root.replaceChildren()
  root.appendChild(brandBar())

  if (!state.signedIn) {
    const body = el('div', { class: 'body' })
    body.appendChild(renderConnect())
    root.appendChild(body)
    return
  }

  root.appendChild(tabStrip())
  const body = el('div', { class: 'body' })
  if (state.view === 'leaderboard') body.appendChild(renderLeaderboard())
  else body.appendChild(renderProfile())
  root.appendChild(body)
}

// ---------- data fetchers ----------

async function refreshAuth() {
  state.authError = null
  const res = await send<AuthUserPayload>({ type: 'AUTH_GET_USER' })
  if (!res.ok) {
    state.authError = res.error
    state.signedIn = false
    state.view = 'connect'
    render()
    return
  }
  const payload = res.data
  if (payload?.user) {
    state.signedIn = true
    state.myLogin = payload.githubLogin
    if (state.view === 'connect') state.view = 'profile'
    render()
    await Promise.all([refreshProfileXp(), refreshTeam()])
  } else {
    state.signedIn = false
    state.myLogin = null
    state.view = 'connect'
    render()
  }
}

async function refreshProfileXp() {
  const res = await send<LeaderboardRow[]>({ type: 'LEADERBOARD_GET' })
  if (!res.ok) return
  const rows = res.data ?? []
  state.board = rows
  if (state.myLogin) {
    const idx = rows.findIndex(r => r.recipient_github_login === state.myLogin)
    if (idx >= 0) {
      state.totalXp = rows[idx].total
      state.rank = idx + 1
    } else {
      state.totalXp = 0
      state.rank = null
    }
  }
  render()
}

async function loadLeaderboard() {
  state.boardError = null
  state.board = null
  render()
  const res = await send<LeaderboardRow[]>({ type: 'LEADERBOARD_GET' })
  if (!res.ok) { state.boardError = res.error; render(); return }
  state.board = res.data ?? []
  render()
}

async function refreshTeam() {
  // Extract the GitHub org from the active tab URL so TEAM_RESOLVE can latch
  // team_id without requiring a PAT. Falls back gracefully if not on GitHub.
  let repoOwner: string | undefined
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const m = tab?.url?.match(/^https:\/\/github\.com\/([^/]+)\//)
    if (m) repoOwner = m[1].toLowerCase()
  } catch { /* tabs API unavailable — ignore */ }

  await send<TeamRow | null>({ type: 'TEAM_RESOLVE', repoOwner })
  const res = await send<TeamRow | null>({ type: 'TEAM_GET' })
  state.team = res.ok ? (res.data ?? null) : null
  render()
}

// ---------- handlers ----------

async function onSignIn() {
  state.authError = null
  state.busy = true
  render()
  try {
    const res = await send({ type: 'AUTH_SIGN_IN_GITHUB' })
    if (!res.ok) state.authError = res.error
  } finally {
    state.busy = false
    await refreshAuth()
  }
}

async function onSignOut() {
  state.authError = null
  state.busy = true
  render()
  try {
    const res = await send({ type: 'AUTH_SIGN_OUT' })
    if (!res.ok) state.authError = res.error
  } finally {
    state.busy = false
    state.totalXp = null
    state.rank = null
    state.board = null
    await refreshAuth()
  }
}

// ---------- boot ----------

render()
void refreshAuth()
