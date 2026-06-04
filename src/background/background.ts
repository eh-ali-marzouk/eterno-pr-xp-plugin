import browser from 'webextension-polyfill'
import { supabase } from '../lib/supabase'
import type {
  AuthUserPayload,
  GrantInput,
  GrantRow,
  LeaderboardRow,
  Message,
  PrRow,
  Response,
  TeamRow
} from '../lib/messages'

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
      case 'PR_GET_OR_CREATE':
        return prGetOrCreate(msg.repo, msg.pr_number, msg.author_github_login)
      case 'PR_SET_POOL':
        return prSetPool(msg.pr_id, msg.xp_pool)
      case 'PR_DISTRIBUTE':
        return prDistribute(msg.pr_id, msg.xp_pool, msg.grants)
      case 'PR_LIST_GRANTS':
        return prListGrants(msg.pr_id)
      case 'LEADERBOARD_GET':
        return leaderboardGet()
      case 'TEAM_GET':
        return teamGet()
      case 'TEAM_RESOLVE':
        return teamResolve(msg)
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
    return { ok: false, error: errMsg(err) }
  }
}

async function signOut(): Promise<Response> {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

async function getUser(): Promise<Response<AuthUserPayload>> {
  const { data, error } = await supabase.auth.getUser()
  if (error) return { ok: true, data: { user: null, githubLogin: null } }
  const user = data.user
  const githubLogin =
    (user?.user_metadata?.user_name as string | undefined) ??
    (user?.user_metadata?.preferred_username as string | undefined) ??
    null
  return { ok: true, data: { user, githubLogin } }
}

async function prGetOrCreate(
  repo: string,
  pr_number: number,
  author_github_login: string
): Promise<Response<PrRow | null>> {
  const existing = await supabase
    .from('prs')
    .select('*')
    .eq('repo', repo)
    .eq('pr_number', pr_number)
    .maybeSingle()
  if (existing.error) return { ok: false, error: existing.error.message }
  if (existing.data) return { ok: true, data: existing.data as PrRow }

  // Only the author can insert; for non-authors viewing a not-yet-tracked PR
  // we return null and the widget shows a read-only "no pool set" state.
  const me = await currentGithubLogin()
  if (me !== author_github_login) return { ok: true, data: null }

  const inserted = await supabase
    .from('prs')
    .insert({ repo, pr_number, author_github_login, xp_pool: 100 })
    .select('*')
    .single()
  if (inserted.error) {
    // 23505 = unique_violation: another concurrent caller (e.g. a re-render
    // racing through the same code path) already inserted. Re-fetch.
    if (inserted.error.code === '23505') {
      const after = await supabase
        .from('prs')
        .select('*')
        .eq('repo', repo)
        .eq('pr_number', pr_number)
        .maybeSingle()
      if (after.error) return { ok: false, error: after.error.message }
      if (after.data) return { ok: true, data: after.data as PrRow }
    }
    if (inserted.error.message.includes('not part of the pilot')) {
      return { ok: false, error: 'Your GitHub org is not part of the pilot.' }
    }
    return { ok: false, error: inserted.error.message }
  }
  return { ok: true, data: inserted.data as PrRow }
}

async function prSetPool(pr_id: number, xp_pool: number): Promise<Response<PrRow>> {
  if (!Number.isInteger(xp_pool) || xp_pool < 0) {
    return { ok: false, error: 'xp_pool must be a non-negative integer' }
  }
  const { data, error } = await supabase
    .from('prs')
    .update({ xp_pool })
    .eq('id', pr_id)
    .select('*')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data as PrRow }
}


async function prDistribute(
  pr_id: number,
  xp_pool: number,
  grants: GrantInput[]
): Promise<Response<PrRow>> {
  if (grants.length === 0) {
    return { ok: false, error: 'No grants to distribute' }
  }
  const totalPct = grants.reduce((sum, g) => sum + g.percentage, 0)
  if (totalPct !== 100) {
    return { ok: false, error: `Percentages must sum to 100 (got ${totalPct})` }
  }

  const { data: me } = await supabase.auth.getUser()
  const granted_by = me.user?.id
  if (!granted_by) return { ok: false, error: 'Not signed in' }

  const rows = grants.map((g) => ({
    pr_id,
    recipient_github_login: g.recipient_github_login,
    percentage: g.percentage,
    points: Math.round((xp_pool * g.percentage) / 100),
    granted_by
  }))

  const ins = await supabase.from('xp_grants').insert(rows)
  if (ins.error) return { ok: false, error: ins.error.message }

  const upd = await supabase
    .from('prs')
    .update({ status: 'distributed' })
    .eq('id', pr_id)
    .select('*')
    .single()
  if (upd.error) return { ok: false, error: upd.error.message }
  return { ok: true, data: upd.data as PrRow }
}

async function prListGrants(pr_id: number): Promise<Response<GrantRow[]>> {
  const { data, error } = await supabase
    .from('xp_grants')
    .select('id, pr_id, recipient_github_login, points, percentage, created_at')
    .eq('pr_id', pr_id)
    .order('points', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as GrantRow[] }
}

async function leaderboardGet(): Promise<Response<LeaderboardRow[]>> {
  const { data, error } = await supabase
    .from('leaderboard')
    .select('recipient_github_login, total')
    .order('total', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: (data ?? []) as LeaderboardRow[] }
}

async function currentGithubLogin(): Promise<string | null> {
  const { data } = await supabase.auth.getUser()
  return (
    (data.user?.user_metadata?.user_name as string | undefined) ??
    (data.user?.user_metadata?.preferred_username as string | undefined) ??
    null
  )
}


async function teamGet(): Promise<Response<TeamRow | null>> {
  const { data: me } = await supabase.auth.getUser()
  const uid = me.user?.id
  if (!uid) return { ok: true, data: null }
  const { data, error } = await supabase
    .from('profiles')
    .select('team_id, teams ( id, name, github_org )')
    .eq('id', uid)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  const team = (data?.teams ?? null) as TeamRow | null
  return { ok: true, data: team }
}

// Resolve and latch the caller's profiles.team_id.
// Strategy: (1) if already set, return it; (2) look up the pilot team by
// msg.repoOwner (the GitHub org extracted from the current tab URL by the caller);
// (3) else return null.
async function teamResolve(msg: Extract<Message, { type: 'TEAM_RESOLVE' }>): Promise<Response<TeamRow | null>> {
  const { data: me } = await supabase.auth.getUser()
  const uid = me.user?.id
  if (!uid) return { ok: true, data: null }

  // Already resolved?
  const existing = await teamGet()
  if (existing.ok && existing.data) return existing

  const org = msg.repoOwner?.toLowerCase()
  if (!org) return { ok: true, data: null }

  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, name, github_org')
    .eq('github_org', org)
    .limit(1)
  if (error) return { ok: false, error: error.message }
  const team = (teams?.[0] ?? null) as TeamRow | null
  if (!team) return { ok: true, data: null }

  const upd = await supabase.from('profiles').update({ team_id: team.id }).eq('id', uid)
  if (upd.error) return { ok: false, error: upd.error.message }
  return { ok: true, data: team }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
