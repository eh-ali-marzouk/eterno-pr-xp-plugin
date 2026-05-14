# PR XP — Project Context

## What this is

A cross-browser (Chrome + Firefox) MV3 extension that gamifies GitHub code review for a 10-person engineering team. PR authors set an XP pool on each PR; after merge, the author distributes those XP among reviewers/commenters by percentage. Totals roll up into a team leaderboard.

## Stack

- **Extension:** TypeScript + Vite + `@crxjs/vite-plugin`, Manifest V3
- **Cross-browser shim:** `webextension-polyfill` (use `browser.*`, not `chrome.*`)
- **Backend:** Supabase (Postgres + Auth + RLS) — free tier
- **Auth:** GitHub OAuth via Supabase
- **No custom server.** Supabase REST is the only backend.

## Project layout

```
src/
├── content/content.ts        # injected on github.com/*/*/pull/*
├── background/background.ts  # event page / service worker, holds Supabase client
├── popup/                    # login + leaderboard UI
├── lib/
│   ├── supabase.ts           # typed client
│   ├── github.ts             # GitHub REST calls
│   └── messages.ts           # discriminated union of message types
└── types/database.ts         # generated via `npm run types:db`
manifest.config.ts            # typed manifest, dual Chrome/Firefox background
vite.config.ts
```

Build output goes to `dist/`.
- Chrome: `chrome://extensions` → Load unpacked → `dist/`
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/manifest.json`

## Cross-browser considerations

- Manifest declares **both** `background.service_worker` (Chrome) **and** `background.scripts` (Firefox). Chrome 121+ and Firefox 121+ each ignore the field they don't use.
- `browser_specific_settings.gecko.id` is set so Firefox has a stable extension ID — required for OAuth redirect URL stability.
- Write the background script as an **event page**: listeners registered at top level, no reliance on persistent globals, state in `storage.local` or DB, `alarms` instead of `setTimeout`. Code written this way runs correctly as both a Chrome service worker and a Firefox event page.
- Use `webextension-polyfill` so all extension APIs are promise-based and identical across browsers.
- Both `chrome-extension://<id>/...` and `moz-extension://<id>/...` redirect URLs must be registered in Supabase Auth settings.

## Data model (Supabase)

- `profiles` — `id` (uuid, FK auth.users), `github_login` unique, `display_name`
- `prs` — `id`, `repo`, `pr_number`, `author_github_login`, `xp_pool` int, `status` ('open' | 'distributed'), unique on (repo, pr_number)
- `xp_grants` — `id`, `pr_id` FK, `recipient_github_login`, `points` int, `percentage` int, `granted_by` FK profiles
- Leaderboard view: `select recipient_github_login, sum(points) total from xp_grants group by 1`

## RLS rules

- Read: any authenticated user can read all 3 tables + leaderboard view.
- `prs` insert/update: only when `auth.jwt() ->> 'user_name' = author_github_login`.
- `xp_grants` insert: only by the PR author; blocked once `prs.status = 'distributed'`; trigger enforces sum of percentages = 100.

## Architecture conventions

- **Content script never holds the Supabase client.** All DB/API calls go through `browser.runtime.sendMessage` to the background.
- Message types: discriminated union exported from `src/lib/messages.ts`, imported on both sides.
- GitHub API token: MVP = user pastes a fine-grained PAT into the popup once, stored in `browser.storage.local`. Upgrade later to Supabase `provider_token`.
- Use GitHub's CSS variables (`var(--color-canvas-default)` etc.) for injected UI to match light/dark themes.

## Weekend milestones

1. Scaffold + hello-world content script (panel on PR pages, loaded in both browsers)
2. Supabase project, SQL schema, generated DB types
3. GitHub OAuth login flow via Supabase, popup shows signed-in user (works in both browsers)
4. XP pool widget on PR page (author-only write)
5. Distribution form after merge: fetch reviewers/commenters, percentage sliders summing to 100, write `xp_grants` + flip `prs.status`
6. Leaderboard tab in popup
7. Reviewer XP badges next to avatars on PR pages
8. Package `dist/` for Chrome and a signed `.xpi` for Firefox; share install instructions

## Out of scope for v1

- Publishing to Chrome Web Store or AMO permanently
- GitLab / Bitbucket support
- Auto-suggesting splits from review activity
- Slack digest, achievements/badges

## Decisions already made

- Author has full control over splits (including 100% to themselves) — by design. Audit log via `xp_grants.granted_by` + `created_at` is the safeguard.
- No tests beyond manual smoke testing for the weekend MVP.
- Plain DOM injection in content script (no React there). Popup may use React later.
- Both Chrome and Firefox supported from day one, single codebase.

## Cost

$0. Supabase free tier covers usage. Chrome Web Store ($5) and Firefox AMO (free) only needed if publishing.
