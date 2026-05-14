export type Message =
  | { type: 'PING' }

export type Response =
  | { ok: true; data?: unknown }
  | { ok: false; error: string }
