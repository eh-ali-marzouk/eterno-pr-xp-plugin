import browser from 'webextension-polyfill'
import type {
  AuthUserPayload,
  LeaderboardRow,
  Message,
  Response,
  TokenStatus
} from '../lib/messages'

const statusEl = document.getElementById('status') as HTMLParagraphElement
const buttonEl = document.getElementById('primary') as HTMLButtonElement
const errorEl = document.getElementById('error') as HTMLParagraphElement

const tokenSection = document.getElementById('token-section') as HTMLDivElement
const tokenSavedRow = document.getElementById('token-saved') as HTMLDivElement
const tokenSavedText = document.getElementById('token-saved-text') as HTMLSpanElement
const tokenInputWrap = document.getElementById('token-input-wrap') as HTMLDivElement
const tokenInput = document.getElementById('token-input') as HTMLInputElement
const tokenSave = document.getElementById('token-save') as HTMLButtonElement
const tokenClear = document.getElementById('token-clear') as HTMLButtonElement
const tokenCancel = document.getElementById('token-cancel') as HTMLButtonElement
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

function showInputMode(hasExisting: boolean) {
  tokenSavedRow.hidden = true
  tokenInputWrap.hidden = false
  tokenCancel.hidden = !hasExisting
  tokenInput.value = ''
  tokenInput.focus()
}

function showSavedMode(login: string | undefined) {
  tokenSavedRow.hidden = false
  tokenInputWrap.hidden = true
  tokenSavedText.textContent = login ? `Token saved (validated as @${login}).` : 'Token saved.'
  tokenStatus.textContent = ''
}

async function refreshTokenStatus() {
  tokenStatus.textContent = 'Checking GitHub token…'
  const res = await send<TokenStatus>({ type: 'GH_TOKEN_VALIDATE' })
  if (!res.ok) {
    tokenStatus.textContent = res.error
    showInputMode(false)
    return
  }
  const status = res.data!
  switch (status.state) {
    case 'absent':
      tokenStatus.textContent = 'No GitHub token saved.'
      showInputMode(false)
      return
    case 'valid':
      showSavedMode(status.login)
      return
    case 'invalid':
      tokenStatus.textContent = `Saved token is invalid: ${status.error}`
      showInputMode(true)
      return
  }
}

tokenSave.addEventListener('click', async () => {
  const value = tokenInput.value.trim()
  if (!value) {
    tokenStatus.textContent = 'Paste a token first.'
    return
  }
  tokenSave.disabled = true
  tokenStatus.textContent = 'Saving…'
  const res = await send({ type: 'GH_TOKEN_SET', token: value })
  tokenSave.disabled = false
  if (!res.ok) {
    tokenStatus.textContent = res.error
    return
  }
  await refreshTokenStatus()
})

tokenClear.addEventListener('click', () => {
  // "Replace" — keep the stored token until a new one is saved, but reveal
  // the input so the user can paste a fresh one without first clearing.
  showInputMode(true)
})

tokenCancel.addEventListener('click', () => {
  void refreshTokenStatus()
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
