import browser from 'webextension-polyfill'
import type { Message, Response } from '../lib/messages'

const PANEL_ID = 'pr-xp-panel'

const SIDEBAR_SELECTORS = [
  '.discussion-sidebar',
  '#partial-discussion-sidebar',
  '.Layout-sidebar',
  '[data-testid="sidebar"]',
  '[data-testid="issue-viewer-metadata-container"]',
  '[data-testid="issue-viewer-metadata-pane"]',
  'div[class*="SidebarSection"]',
  'aside[aria-label="Sidebar"]'
]

function findSidebar(): Element | null {
  for (const sel of SIDEBAR_SELECTORS) {
    const el = document.querySelector(sel)
    if (el) return el
  }
  // Fallback: find the "Reviewers" heading and walk up to the panel container.
  const headings = document.querySelectorAll('h2, h3')
  for (const h of headings) {
    if (/^Reviewers$/i.test(h.textContent?.trim() ?? '')) {
      let node: Element | null = h
      for (let i = 0; i < 6 && node; i++) {
        const parent = node.parentElement
        if (!parent) break
        if (parent.tagName === 'ASIDE' || parent.getAttribute('role') === 'complementary') {
          return parent
        }
        node = parent
      }
      return h.parentElement
    }
  }
  return null
}

function buildPanel(mode: 'sidebar' | 'floating'): HTMLElement {
  const el = document.createElement('div')
  el.id = PANEL_ID

  const sidebarStyle = [
    'margin-top:16px',
    'padding:12px',
    'border:1px solid var(--color-border-default, #d0d7de)',
    'border-radius:6px',
    'background:var(--color-canvas-subtle, #f6f8fa)',
    'color:var(--color-fg-default, #1f2328)',
    'font-size:12px',
    'line-height:1.5'
  ].join(';')

  const floatingStyle = [
    'position:fixed',
    'bottom:16px',
    'right:16px',
    'z-index:2147483647',
    'padding:12px 14px',
    'border:1px solid var(--color-border-default, #d0d7de)',
    'border-radius:8px',
    'background:var(--color-canvas-default, #ffffff)',
    'color:var(--color-fg-default, #1f2328)',
    'font-size:12px',
    'line-height:1.5',
    'box-shadow:0 4px 12px rgba(0,0,0,0.15)',
    'min-width:160px'
  ].join(';')

  el.style.cssText = mode === 'sidebar' ? sidebarStyle : floatingStyle

  const title = document.createElement('div')
  title.textContent = 'PR XP'
  title.style.cssText = 'font-weight:600;margin-bottom:4px'

  const body = document.createElement('div')
  body.textContent = mode === 'sidebar' ? 'hello' : 'hello (floating fallback — sidebar anchor not found)'

  el.appendChild(title)
  el.appendChild(body)
  return el
}

function injectPanel(): void {
  if (document.getElementById(PANEL_ID)) return
  const sidebar = findSidebar()
  if (sidebar) {
    sidebar.appendChild(buildPanel('sidebar'))
    console.log('[pr-xp] panel injected into sidebar:', sidebar)
  } else {
    document.body.appendChild(buildPanel('floating'))
    console.log('[pr-xp] sidebar not found — using floating panel')
  }
}

injectPanel()

const observer = new MutationObserver(() => injectPanel())
observer.observe(document.body, { childList: true, subtree: true })

const ping: Message = { type: 'PING' }
browser.runtime
  .sendMessage(ping)
  .then((r: Response) => console.log('[pr-xp] bg says', r))
  .catch((err) => console.warn('[pr-xp] ping failed', err))
