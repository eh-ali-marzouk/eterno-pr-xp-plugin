import type { User } from '@supabase/supabase-js'

export type Message =
  | { type: 'PING' }
  | { type: 'AUTH_SIGN_IN_GITHUB' }
  | { type: 'AUTH_SIGN_OUT' }
  | { type: 'AUTH_GET_USER' }
  | { type: 'AUTH_GET_REDIRECT_URL' }
  | { type: 'PR_GET_OR_CREATE'; repo: string; pr_number: number; author_github_login: string }
  | { type: 'PR_SET_POOL'; pr_id: number; xp_pool: number }
  | { type: 'PR_FETCH_PARTICIPANTS'; repo: string; pr_number: number; author_github_login: string }
  | { type: 'PR_DISTRIBUTE'; pr_id: number; xp_pool: number; grants: GrantInput[] }
  | { type: 'PR_LIST_GRANTS'; pr_id: number }
  | { type: 'LEADERBOARD_GET' }
  | { type: 'GH_TOKEN_GET' }
  | { type: 'GH_TOKEN_SET'; token: string }
  | { type: 'GH_TOKEN_CLEAR' }

export type Response<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export type AuthUserPayload = {
  user: User | null
  githubLogin: string | null
}

export type PrRow = {
  id: number
  repo: string
  pr_number: number
  author_github_login: string
  xp_pool: number
  status: 'open' | 'distributed'
}

export type GrantInput = {
  recipient_github_login: string
  percentage: number
}

export type GrantRow = {
  id: number
  pr_id: number
  recipient_github_login: string
  points: number
  percentage: number
  created_at: string
}

export type LeaderboardRow = {
  recipient_github_login: string
  total: number
}
