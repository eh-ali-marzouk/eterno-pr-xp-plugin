import browser from 'webextension-polyfill'

const TOKEN_KEY = 'github_pat'

export async function getStoredToken(): Promise<string | null> {
  const result = await browser.storage.local.get(TOKEN_KEY)
  const v = result[TOKEN_KEY]
  return typeof v === 'string' && v.length > 0 ? v : null
}

export async function setStoredToken(token: string): Promise<void> {
  await browser.storage.local.set({ [TOKEN_KEY]: token })
}

export async function clearStoredToken(): Promise<void> {
  await browser.storage.local.remove(TOKEN_KEY)
}

export async function validateToken(token: string): Promise<{ valid: boolean; login?: string; error?: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })
    if (res.status === 401) return { valid: false, error: 'Token rejected (401). Generate a new PAT.' }
    if (!res.ok) return { valid: false, error: `GitHub ${res.status}` }
    const body = (await res.json()) as { login?: string }
    return { valid: true, login: body.login }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}

async function ghFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

type ReviewItem = { user: { login: string } | null }
type CommentItem = { user: { login: string } | null }

/**
 * Returns the unique set of GitHub logins that reviewed or commented on a PR,
 * excluding the author. Combines:
 *  - reviews (approvals, change requests, comments-as-reviews)
 *  - issue comments (the main PR conversation thread)
 *  - review comments (inline code comments)
 */
export async function fetchPrParticipants(
  repo: string,
  prNumber: number,
  author: string,
  token: string
): Promise<string[]> {
  const [reviews, issueComments, reviewComments] = await Promise.all([
    ghFetch<ReviewItem[]>(`/repos/${repo}/pulls/${prNumber}/reviews?per_page=100`, token),
    ghFetch<CommentItem[]>(`/repos/${repo}/issues/${prNumber}/comments?per_page=100`, token),
    ghFetch<CommentItem[]>(`/repos/${repo}/pulls/${prNumber}/comments?per_page=100`, token)
  ])

  const set = new Set<string>()
  for (const r of reviews) if (r.user?.login) set.add(r.user.login)
  for (const c of issueComments) if (c.user?.login) set.add(c.user.login)
  for (const c of reviewComments) if (c.user?.login) set.add(c.user.login)
  set.delete(author)
  return [...set].sort((a, b) => a.localeCompare(b))
}
