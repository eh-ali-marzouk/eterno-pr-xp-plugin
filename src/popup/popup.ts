import browser from 'webextension-polyfill'
import type { AuthUserPayload, Message, Response } from '../lib/messages'

const statusEl = document.getElementById('status') as HTMLParagraphElement
const buttonEl = document.getElementById('primary') as HTMLButtonElement
const errorEl = document.getElementById('error') as HTMLParagraphElement

type Mode = 'signed-in' | 'signed-out'

function setError(msg: string | null) {
  if (msg) {
    errorEl.textContent = msg
    errorEl.hidden = false
  } else {
    errorEl.textContent = ''
    errorEl.hidden = true
  }
}

function render(mode: Mode, githubLogin?: string | null) {
  buttonEl.hidden = false
  if (mode === 'signed-in') {
    statusEl.textContent = githubLogin
      ? `Signed in as @${githubLogin}`
      : 'Signed in'
    buttonEl.textContent = 'Sign out'
    buttonEl.onclick = onSignOut
  } else {
    statusEl.textContent = 'Not signed in'
    buttonEl.textContent = 'Sign in with GitHub'
    buttonEl.onclick = onSignIn
  }
}

async function send<T = unknown>(msg: Message): Promise<Response<T>> {
  return (await browser.runtime.sendMessage(msg)) as Response<T>
}

async function refresh() {
  setError(null)
  const res = await send<AuthUserPayload>({ type: 'AUTH_GET_USER' })
  if (!res.ok) {
    setError(res.error)
    render('signed-out')
    return
  }
  const payload = res.data
  if (payload?.user) render('signed-in', payload.githubLogin)
  else render('signed-out')
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
    await refresh()
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
    await refresh()
  }
}

refresh()
