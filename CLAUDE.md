# PR XP — Project Context

## What this is

A cross-browser (Chrome + Firefox) MV3 extension ("Review-Master") that gamifies GitHub code review. PR authors set an XP pool on each PR; after merge, the author distributes those XP among reviewers/commenters by percentage. Totals roll up into a **per-team** leaderboard.

The extension is **multi-tenant**: a "team" is a GitHub org (the repo owner), and each org's PRs, grants, profiles, and leaderboard are fully isolated by Postgres RLS. See `docs/multi-tenancy-design.md` for the locked design and `docs/multi-tenancy-implementation-plan.md` for the step-by-step state.

> **Deep dive:** `docs/DEVELOPER_MANUAL.md` is the authoritative, file-by-file guide for picking up work on this codebase. Read it before non-trivial changes. Pilot install instructions live in `ONBOARDING.md` at the repo root.

## Stack

- **Extension:** TypeScript + Vite + `@crxjs/vite-plugin`, Manifest V3
- **Cross-browser shim:** `webextension-polyfill` (use `browser.*`, not `chrome.*`)
- **Backend:** Supabase (Postgres + Auth + RLS) — free tier
- **Auth:** GitHub OAuth via Supabase
- **No custom server.** Supabase REST is the only backend.

## Project layout

```
src/
├── content/
│   ├── content.ts            # injected widget on github.com/*/*/pull/*; plain DOM + shadow root
│   └── pr-page.ts            # parses repo / pr_number / author / merged-state from the DOM+URL
├── background/background.ts  # event page / service worker; ONLY holder of the Supabase client
├── popup/
│   ├── popup.ts              # connect | profile | leaderboard views
│   ├── popup.html
│   └── popup.css
├── lib/
│   ├── supabase.ts           # typed client (PKCE, session in storage.local via ext-storage)
│   ├── ext-storage.ts        # SupportedStorage adapter backing Supabase auth to storage.local
│   ├── github.ts             # GitHub REST calls + PAT storage helpers
│   ├── messages.ts           # discriminated Message union + Response<T> + row types
│   └── identicon.ts          # deterministic pixel-art avatars
├── styles/                   # pixel.css (component lib + GitHub CSS vars), fonts.css
├── assets/                   # icons + woff2 pixel fonts
└── types/database.ts         # generated via `npm run types:db`
supabase/migrations/          # SQL migrations (20260514* core, 20260528* multi-tenancy)
scripts/
├── patch-manifest.mjs        # post-build: injects background.scripts for Firefox
└── package.mjs               # zips dist/ into releases/review-master-<ver>-{chrome,firefox}.zip
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

- `teams` — `id` (bigserial), `name`, `github_org` unique (lowercased repo owner). Seeded manually (pilot orgs). **The tenant boundary.**
- `profiles` — `id` (uuid, FK auth.users), `github_login` unique, `display_name`, `team_id` FK→teams (**nullable** — unassigned until resolved)
- `prs` — `id`, `repo`, `pr_number`, `author_github_login`, `xp_pool` int (default 100), `status` ('open' | 'distributed'), `team_id` FK→teams (**NOT NULL**, server-derived), unique on (repo, pr_number)
- `xp_grants` — `id`, `pr_id` FK, `recipient_github_login`, `points` int, `percentage` int, `granted_by` FK profiles, `team_id` FK→teams (**NOT NULL**, inherited from PR)
- Leaderboard view: `select team_id, recipient_github_login, sum(points)::int total from xp_grants group by team_id, recipient_github_login` — runs `security_invoker = true` so the caller's `xp_grants` RLS applies.

## Multi-tenancy (the trust boundary)

- **`team_id` is NEVER sent by the client.** The DB derives and enforces it:
  - `prs`: a `BEFORE INSERT` trigger (`prs_set_team`) derives team from `lower(split_part(repo,'/',1))`, rejects non-pilot orgs (`check_violation`, surfaced as "Your GitHub org is not part of the pilot."), and latches the author's `profiles.team_id`.
  - `xp_grants`: a `BEFORE INSERT` trigger (`xp_grants_set_team`) copies the parent PR's `team_id`.
  - `profiles`: latched by the `prs` trigger (authors) and by the `TEAM_RESOLVE` message (reviewers, via GitHub `/user/orgs`).
- **Team resolution** happens client-side via `TEAM_RESOLVE`: the background reads the user's PAT, calls GitHub `/user/orgs` (**requires `read:org`**), matches an org against `teams.github_org`, and latches `profiles.team_id` (allowed by `profiles_update_self`). Both the popup (on load) and the content script (in `refresh()`, before `PR_GET_OR_CREATE`) send it.
- **Known gap:** a user whose PAT lacks `read:org` cannot be auto-resolved at all — including a first-time *author* (the tightened `prs_insert_author` check requires `my_team_id()` to already match the repo org). The design's optional repo-owner fallback (`msg.repoOwner`) is **not implemented**.

## RLS rules

- `my_team_id()` — `security definer` helper returning the caller's `profiles.team_id` (avoids recursive RLS on profiles).
- **Read (team-scoped):** `profiles_select_team` (`id = auth.uid() or team_id = my_team_id()`), `prs_select_team` / `xp_grants_select_team` (`team_id = my_team_id()`), `teams_select_own` (`id = my_team_id()`). These replaced the old global `using (true)` policies.
- `prs` insert (`prs_insert_author`): JWT login = `author_github_login` **AND** the repo's org == caller's team.
- `prs` update (`prs_update_author`): JWT login = `author_github_login`.
- `xp_grants` insert (`xp_grants_insert_author_while_open`): only by the PR author, only while `prs.status = 'open'`; a `BEFORE UPDATE` trigger on `prs` enforces sum of percentages = 100 on the flip to `distributed`.
- `profiles_update_self`: a user may update only their own row (enables the `TEAM_RESOLVE` latch).
- **JWT login path** (reuse verbatim): `coalesce(auth.jwt() -> 'user_metadata' ->> 'user_name', auth.jwt() -> 'user_metadata' ->> 'preferred_username')`.

## Architecture conventions

- **Content script never holds the Supabase client.** All DB/API calls go through `browser.runtime.sendMessage` to the background, which is the sole holder of the Supabase client. Both sides use a typed `send<T>(msg): Promise<Response<T>>` wrapper.
- Message types: discriminated `Message` union + `Response<T>` exported from `src/lib/messages.ts`, imported on both sides. Add a new feature = add a `Message` variant + a `case` + a handler.
- **Two GitHub credentials, distinct roles:** (1) OAuth session (scopes `read:user user:email`) via `browser.identity.launchWebAuthFlow` + Supabase PKCE = *identity*; (2) a user-pasted **PAT** stored in `browser.storage.local` key `github_pat` (needs `read:org`) = *GitHub REST access* (participants, `/user/orgs`). Don't conflate them.
- Injected UI uses the repo's pixel-art design system in `src/styles/pixel.css` (CSS vars like `var(--gh-bg)`, `var(--gh-green)`, `var(--xp-gold)`) rendered inside a **shadow root** to isolate from GitHub's styles. NOTE: these are the extension's *own* vars (currently dark-tuned), not GitHub's `--color-*` vars.

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
