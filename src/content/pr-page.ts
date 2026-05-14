/**
 * Helpers for extracting state from the GitHub PR page DOM.
 */

export type PrPageInfo = {
  repo: string
  prNumber: number
  authorLogin: string | null
  isMerged: boolean
}

export function parsePrUrl(href: string = location.href): { repo: string; prNumber: number } | null {
  const m = href.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/)
  if (!m) return null
  return { repo: m[1], prNumber: Number(m[2]) }
}

function findAuthorLogin(): string | null {
  // Classic layout: <a class="author Link--primary" href="/login">login</a>
  // near the PR title header.
  const link =
    document.querySelector('#partial-discussion-header .author') ??
    document.querySelector('.gh-header-meta .author') ??
    document.querySelector('[data-testid="author-link"]')
  if (!link) return null
  const text = link.textContent?.trim()
  if (text) return text
  const href = link.getAttribute('href')
  if (href?.startsWith('/')) return href.slice(1).split('/')[0]
  return null
}

function findMergedState(): boolean {
  // Classic: <span class="State State--merged">Merged</span>
  const states = document.querySelectorAll('.State, [class*="State--merged"]')
  for (const s of states) {
    const cls = (s.className || '').toString()
    if (cls.includes('State--merged')) return true
    if (s.textContent?.trim() === 'Merged') return true
  }
  return false
}

export function readPrPageInfo(): PrPageInfo | null {
  const parsed = parsePrUrl()
  if (!parsed) return null
  return {
    repo: parsed.repo,
    prNumber: parsed.prNumber,
    authorLogin: findAuthorLogin(),
    isMerged: findMergedState()
  }
}
