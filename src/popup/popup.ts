import browser from 'webextension-polyfill'
import type {
  AuthUserPayload,
  LeaderboardRow,
  Message,
  Response
} from '../lib/messages'

const statusEl = document.getElementById('status') as HTMLParagraphElement
const buttonEl = document.getElementById('primary') as HTMLButtonElement
const errorEl = document.getElementById('error') as HTMLParagraphElement

const tokenSection = document.getElementById('token-section') as HTMLDivElement
const tokenInput = document.getElementById('token-input') as HTMLInputElement
const tokenSave = document.getElementById('token-save') as HTMLButtonElement
const tokenClear = document.getElementById('token-clear') as HTMLButtonElement
const tokenStatus = document.getElementById('token-status') as HTMLParagraphElement

const lbStatus = document.getElementById('leaderboard-status') as HTMLParagraphElement
const lbList = document.getElementById('leaderboard-list') as HTMLOListElement

const tabs = document.querySelectorAll<HTMLButtonElement>('nav#tabs .tab')
const panels: Record<string, HTMLElement> = {
  account: document.getElementById('tab-account')!,
  leaderboard: document.getElementById('tab-leaderboard')!
}

for (const tab of tabs) {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.toggle('active', t === tab))
    const key = tab.dataset.tab!
    for (const [k, panel] of Object.entries(panels)) panel.hidden = k !== key
    if (key === 'leaderboard') void loadLeaderboard()
  })
}

function setError(msg: string | null) {
  if (msg) {
    errorEl.textContent = msg
    errorEl.hidden = false
  } else {
    errorEl.textContent = ''
    errorEl.hidden = true
  }
}

async function send<T = unknown>(msg: Message): Promise<Response<T>> {
  return (await browser.runtime.sendMessage(msg)) as Response<T>
}

// ---------- account / auth ----------

type Mode = 'signed-in' | 'signed-out'

function renderAuth(mode: Mode, githubLogin?: string | null) {
  buttonEl.hidden = false
  if (mode === 'signed-in') {
    statusEl.textContent = githubLogin
      ? `Signed in as @${githubLogin}`
      : 'Signed in'
    buttonEl.textContent = 'Sign out'
    buttonEl.onclick = onSignOut
    tokenSection.hidden = false
    void refreshTokenStatus()
  } else {
    statusEl.textContent = 'Not signed in'
    buttonEl.textContent = 'Sign in with GitHub'
    buttonEl.onclick = onSignIn
    tokenSection.hidden = true
  }
}

async function refreshAuth() {
  setError(null)
  const res = await send<AuthUserPayload>({ type: 'AUTH_GET_USER' })
  if (!res.ok) {
    setError(res.error)
    renderAuth('signed-out')
    return
  }
  const payload = res.data
  if (payload?.user) renderAuth('signed-in', payload.githubLogin)
  else renderAuth('signed-out')
}

async function onSignIn() {
  setError(null)
  buttonEl.disabled = true
  statusEl.textContent = 'Opening GitHub…'
  try {
    const res = await send({ type: 'AUTH_SIGN_IN_GITHUB' })
    if (!res.ok) setError(res.error)
  } finally {
    buttonEl.disabled = false
    await refreshAuth()
  }
}

async function onSignOut() {
  setError(null)
  buttonEl.disabled = true
  try {
    const res = await send({ type: 'AUTH_SIGN_OUT' })
    if (!res.ok) setError(res.error)
  } finally {
    buttonEl.disabled = false
    await refreshAuth()
  }
}

// ---------- GitHub token ----------

async function refreshTokenStatus() {
  const res = await send<string | null>({ type: 'GH_TOKEN_GET' })
  if (!res.ok) {
    tokenStatus.textContent = res.error
    return
  }
  if (res.data) {
    tokenStatus.textContent = 'Token saved.'
    tokenClear.hidden = false
    tokenInput.placeholder = '••••••••••••••••'
    tokenInput.value = ''
  } else {
    tokenStatus.textContent = 'No token saved.'
    tokenClear.hidden = true
    tokenInput.placeholder = 'github_pat_…'
  }
}

tokenSave.addEventListener('click', async () => {
  const value = tokenInput.value.trim()
  if (!value) {
    tokenStatus.textContent = 'Paste a token first.'
    return
  }
  tokenSave.disabled = true
  const res = await send({ type: 'GH_TOKEN_SET', token: value })
  tokenSave.disabled = false
  if (!res.ok) {
    tokenStatus.textContent = res.error
    return
  }
  tokenInput.value = ''
  await refreshTokenStatus()
})

tokenClear.addEventListener('click', async () => {
  tokenClear.disabled = true
  const res = await send({ type: 'GH_TOKEN_CLEAR' })
  tokenClear.disabled = false
  if (!res.ok) {
    tokenStatus.textContent = res.error
    return
  }
  await refreshTokenStatus()
})

// ---------- leaderboard ----------

async function loadLeaderboard() {
  lbStatus.textContent = 'Loading…'
  lbStatus.hidden = false
  lbList.replaceChildren()
  const res = await send<LeaderboardRow[]>({ type: 'LEADERBOARD_GET' })
  if (!res.ok) {
    lbStatus.textContent = res.error
    return
  }
  const rows = res.data ?? []
  if (rows.length === 0) {
    lbStatus.textContent = 'No XP awarded yet.'
    return
  }
  lbStatus.hidden = true
  for (const row of rows) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.textContent = `@${row.recipient_github_login}`
    const total = document.createElement('span')
    total.className = 'total'
    total.textContent = `${row.total} XP`
    li.append(name, total)
    lbList.appendChild(li)
  }
}

void refreshAuth()
