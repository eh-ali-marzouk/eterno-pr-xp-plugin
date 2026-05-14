import type { User } from '@supabase/supabase-js'

export type Message =
  | { type: 'PING' }
  | { type: 'AUTH_SIGN_IN_GITHUB' }
  | { type: 'AUTH_SIGN_OUT' }
  | { type: 'AUTH_GET_USER' }
  | { type: 'AUTH_GET_REDIRECT_URL' }

export type Response<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string }

export type AuthUserPayload = {
  user: User | null
  githubLogin: string | null
}
