import browser from 'webextension-polyfill'
import { supabase } from '../lib/supabase'
import type { AuthUserPayload, Message, Response } from '../lib/messages'

browser.runtime.onMessage.addListener(
  (msg: Message): Promise<Response> => {
    switch (msg.type) {
      case 'PING':
        return Promise.resolve({ ok: true, data: 'pong' })
      case 'AUTH_SIGN_IN_GITHUB':
        return signInWithGithub()
      case 'AUTH_SIGN_OUT':
        return signOut()
      case 'AUTH_GET_USER':
        return getUser()
      case 'AUTH_GET_REDIRECT_URL':
        return Promise.resolve({ ok: true, data: browser.identity.getRedirectURL() })
      default:
        return Promise.resolve({ ok: false, error: 'unknown message' })
    }
  }
)

browser.runtime.onInstalled.addListener(() => {
  console.log('[pr-xp] background installed, redirect URL =', browser.identity.getRedirectURL())
})

async function signInWithGithub(): Promise<Response> {
  try {
    const redirectTo = browser.identity.getRedirectURL()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
        scopes: 'read:user user:email'
      }
    })
    if (error) return { ok: false, error: error.message }
    if (!data?.url) return { ok: false, error: 'Supabase did not return an OAuth URL' }

    const responseUrl = await browser.identity.launchWebAuthFlow({
      url: data.url,
      interactive: true
    })
    if (!responseUrl) return { ok: false, error: 'No redirect URL returned from auth flow' }

    const url = new URL(responseUrl)
    // PKCE returns ?code=... in the query string; some providers use the hash.
    const code =
      url.searchParams.get('code') ??
      new URLSearchParams(url.hash.replace(/^#/, '')).get('code')
    if (!code) {
      const err =
        url.searchParams.get('error_description') ??
        url.searchParams.get('error') ??
        'no code in redirect URL'
      return { ok: false, error: err }
    }

    const { error: exErr } = await supabase.auth.exchangeCodeForSession(code)
    if (exErr) return { ok: false, error: exErr.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function signOut(): Promise<Response> {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

async function getUser(): Promise<Response<AuthUserPayload>> {
  const { data, error } = await supabase.auth.getUser()
  if (error) {
    // Not signed in is not an error for the popup; return null user.
    return { ok: true, data: { user: null, githubLogin: null } }
  }
  const user = data.user
  const githubLogin =
    (user?.user_metadata?.user_name as string | undefined) ??
    (user?.user_metadata?.preferred_username as string | undefined) ??
    null
  return { ok: true, data: { user, githubLogin } }
}
