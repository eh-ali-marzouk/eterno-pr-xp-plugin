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
  // Try increasingly specific anchors. The first text-bearing match wins.
  // On the new GitHub PR layout there is no #partial-discussion-header, but
  // an `a.author` link still exists in the page header.
  const candidates: (Element | null)[] = [
    document.querySelector('#partial-discussion-header a.author'),
    document.querySelector('.gh-header-meta a.author'),
    document.querySelector('a.author'),
    document.querySelector('[data-testid="author-link"]'),
    // Fallback: the first user-hovercard link in the PR header region.
    // (Excludes avatar-only links which have empty text.)
    ...Array.from(document.querySelectorAll('a[data-hovercard-type="user"]'))
  ]
  for (const link of candidates) {
    if (!link) continue
    const text = link.textContent?.trim()
    if (text) return text
    const href = link.getAttribute('href')
    if (href?.startsWith('/')) {
      const login = href.slice(1).split('/')[0]
      if (login) return login
    }
  }
  return null
}

function findMergedState(): boolean {
  // Classic: <span class="State State--merged">Merged</span>
  // New layout: <span class="prc-StateLabel-StateLabel-<hash>">Merged</span>
  const states = document.querySelectorAll(
    '.State, [class*="State--merged"], [class*="StateLabel"]'
  )
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
