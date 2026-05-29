# Review-Master — Developer Manual

> **Audience:** an engineer or AI agent picking up work on this codebase.
> This is the deep, file-by-file reference. For the short version read `CLAUDE.md`;
> for the multi-tenancy design read `docs/multi-tenancy-design.md`; for pilot install
> read `ONBOARDING.md`. This manual is descriptive (what *is*), not prescriptive — it
> reflects the code as of the multi-tenancy rollout. When code and manual disagree, the
> code wins — fix the manual.

---

## 1. What the product does

Review-Master is a cross-browser (Chrome + Firefox) **Manifest V3** browser extension that
gamifies GitHub pull-request review:

1. A PR **author** sets an **XP pool** on their PR (default 100).
2. After the PR **merges**, the author opens a **distribution form** and splits the pool among
   reviewers/commenters by percentage (must sum to 100).
3. Distribution writes immutable **`xp_grants`** and flips the PR to `distributed`.
4. Totals roll up into a **per-team leaderboard** shown in the popup.

It is **multi-tenant**: a *team* is a **GitHub org** (the repo owner, e.g. `acme/backend` → team
`acme`). Each org's data is fully isolated by Postgres Row-Level Security. There is no custom
server — **Supabase** (Postgres + Auth + RLS) is the only backend.

---

## 2. The one architectural rule

> **The content script and popup never hold the Supabase client. The background does.**

Every DB/API operation is a message round-trip:

```
content.ts / popup.ts ──browser.runtime.sendMessage(Message)──▶ background.ts
                       ◀──────────── Response<T> ──────────────
```

Both sides import the **same** `Message` union and `Response<T>` type from
`src/lib/messages.ts`, and both wrap sending in a tiny typed helper:

```ts
async function send<T = unknown>(msg: Message): Promise<Response<T>> {
  return (await browser.runtime.sendMessage(msg)) as Response<T>
}
```

`Response<T> = { ok: true; data?: T } | { ok: false; error: string }`. Handlers **never throw to
the caller** — they catch and return `{ ok: false, error }`.

**To add a feature:** add a variant to the `Message` union → add a `case` in the background router
→ write the handler returning `Response<T>` → call it from content/popup via `send<T>()`. That's
the whole pattern.

Use `browser.*` (the `webextension-polyfill`), **never** `chrome.*` — it's promise-based and
identical across both browsers.

---

## 3. Repo layout & where things live

```
src/
├── background/background.ts   # message router + ALL handlers; sole Supabase client holder
├── content/
│   ├── content.ts             # the on-PR-page widget (shadow DOM, plain DOM rendering)
│   └── pr-page.ts             # parse repo / pr_number / author / merged from URL+DOM
├── popup/
│   ├── popup.ts               # connect | profile | leaderboard views
│   ├── popup.html, popup.css
├── lib/
│   ├── supabase.ts            # createClient<Database>, PKCE, ext-storage adapter
│   ├── ext-storage.ts         # SupportedStorage backed by browser.storage.local
│   ├── github.ts              # ghFetch + token storage + validateToken + fetchPrParticipants + fetchUserOrgs
│   ├── messages.ts            # Message union, Response<T>, all row types
│   └── identicon.ts           # deterministic pixel avatars (pure fn)
├── styles/pixel.css           # design system: CSS vars + component classes + animations
├── styles/fonts.css           # @font-face for Press Start 2P + VT323
├── assets/                    # icons (16/32/48/128) + woff2 fonts
└── types/database.ts          # GENERATED — do not hand-edit unless CLI unavailable
supabase/migrations/           # ordered SQL; 20260514* = core, 20260528* = multi-tenancy
scripts/
├── patch-manifest.mjs         # post-build Firefox background.scripts injection
└── package.mjs                # zip dist/ → releases/
manifest.config.ts             # typed manifest (dual Chrome/Firefox background)
vite.config.ts
```

---

## 4. Background layer (`src/background/background.ts`)

The entry point registers a single listener **at top level** (required for an event page /
service worker — no persistent globals, no `setTimeout` reliance):

```ts
browser.runtime.onMessage.addListener((msg: Message) => { switch (msg.type) { ... } })
```

### 4.1 Message → handler table

| Message | Handler | What it does |
|---|---|---|
| `PING` | inline | health check → `{ok:true,data:'pong'}` |
| `AUTH_SIGN_IN_GITHUB` | `signInWithGithub()` | OAuth via `browser.identity.launchWebAuthFlow` + Supabase PKCE |
| `AUTH_SIGN_OUT` | `signOut()` | `supabase.auth.signOut()` |
| `AUTH_GET_USER` | `getUser()` | returns `{ user, githubLogin }` (`AuthUserPayload`) |
| `AUTH_GET_REDIRECT_URL` | inline | `browser.identity.getRedirectURL()` (for Supabase setup) |
| `PR_GET_OR_CREATE` | `prGetOrCreate()` | select by (repo, pr_number); insert if caller is author; handles 23505 race; maps non-pilot error |
| `PR_SET_POOL` | `prSetPool()` | update `xp_pool` (validates int ≥ 0) |
| `PR_FETCH_PARTICIPANTS` | `prFetchParticipants()` | GitHub API → reviewers + comment authors (needs PAT) |
| `PR_DISTRIBUTE` | `prDistribute()` | insert grants + flip `status` to `distributed` |
| `PR_LIST_GRANTS` | `prListGrants()` | grants for a PR, by points desc |
| `LEADERBOARD_GET` | `leaderboardGet()` | the `leaderboard` view, by total desc |
| `GH_TOKEN_GET/SET/CLEAR` | inline | PAT in `browser.storage.local['github_pat']` |
| `GH_TOKEN_VALIDATE` | `ghTokenValidate()` | GitHub `/user` → `TokenStatus` |
| `TEAM_GET` | `teamGet()` | caller's `profiles` row joined to `teams` |
| `TEAM_RESOLVE` | `teamResolve()` | latch `profiles.team_id` from `/user/orgs` |

### 4.2 Auth / OAuth flow (`signInWithGithub`)

1. `redirectTo = browser.identity.getRedirectURL()` (e.g. `https://<id>.chromiumapp.org/`).
2. `supabase.auth.signInWithOAuth({ provider:'github', options:{ redirectTo, skipBrowserRedirect:true, scopes:'read:user user:email' } })` → returns a GitHub auth URL.
3. `browser.identity.launchWebAuthFlow({ url, interactive:true })` opens the consent window; the
   redirect comes back with a `code`.
4. Parse `code` from the returned URL (query **or** hash), then
   `supabase.auth.exchangeCodeForSession(code)` → JWT + refresh token persisted to
   `browser.storage.local` (via the `ext-storage` adapter).

**GitHub login from the JWT** (used in handlers and mirrored in RLS):
```ts
user?.user_metadata?.user_name ?? user?.user_metadata?.preferred_username ?? null
```
`currentGithubLogin()` is the helper wrapping this.

> **Redirect-URL allow-list (pilot setup — TODO: tighten before production).** The
> redirect from `getRedirectURL()` is **not stable per install**: Chrome derives the
> extension id from the unpacked folder path (differs per developer/machine unless a
> manifest `"key"` pins it), and Firefox returns `https://<random-per-install-UUID>.extensions.allizom.org/`
> (cannot be pre-registered at all). Because exact URLs aren't enumerable, the hosted
> Supabase project's **Auth → URL Configuration → Redirect URLs** is currently set with
> **wildcards**: `https://*.chromiumapp.org/` (Chrome) and `https://*.extensions.allizom.org/`
> (Firefox). This is intentionally broad — it accepts any extension's redirect on those
> domains — and is acceptable only for the closed pilot.
> **Before production:** pin the Chrome id with a manifest `"key"` and replace the Chrome
> wildcard with the one exact `https://<id>.chromiumapp.org/` URL; revisit the Firefox
> entry (signed-AMO id, or a different redirect strategy) to drop its wildcard too.
> The Site URL fallback is `http://127.0.0.1:49283` (was `:3000`, moved to avoid colliding
> with developers' local dev servers — see `supabase/config.toml`).

### 4.3 Supabase client (`src/lib/supabase.ts`)

`createClient<Database>(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, { auth: { storage: extStorage,
flowType:'pkce', persistSession:true, autoRefreshToken:true, detectSessionInUrl:false } })`.

- URL/key come from **Vite env** (`.env.local`; see `.env.example`). Build fails if missing.
- Service workers have no `localStorage`, so `ext-storage.ts` adapts Supabase's `SupportedStorage`
  to `browser.storage.local` (`getItem`/`setItem`/`removeItem`).
- All RLS-protected queries run as the **authenticated** role using the user's JWT.

### 4.4 GitHub REST (`src/lib/github.ts`)

- `ghFetch<T>(path, token)` — `GET https://api.github.com${path}`, headers `Authorization: Bearer`,
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; throws on non-OK.
- `validateToken(token)` → `{ valid, login?, error? }` via `/user`.
- `fetchPrParticipants(repo, prNumber, author, token)` — unions PR **reviews**, **issue comments**,
  and **review (inline) comments**, dedupes, drops the author, sorts.
- `fetchUserOrgs(token)` — `/user/orgs?per_page=100`, lowercased; **returns `[]` if the PAT lacks
  `read:org`** (this is why `read:org` matters — see §6).
- Token storage helpers: `getStoredToken` / `setStoredToken` / `clearStoredToken`
  (`browser.storage.local['github_pat']`).

---

## 5. Frontend layer

### 5.1 Content script (`src/content/content.ts`, ~1150 lines)

**Injection:** declared in the manifest for `https://github.com/*/*/pull/*`, `run_at:
document_idle`. GitHub is an SPA, so the script also re-derives state on navigation.

**Lifecycle:**
- `refresh()` guards against concurrent runs (`refreshInFlight`), delegates to `refreshImpl()`.
- `refreshImpl()`: `readPrPageInfo()` → `AUTH_GET_USER` → (if signed in) **`TEAM_RESOLVE`** →
  **`PR_GET_OR_CREATE`** → if `distributed`, `refreshGrants()` → `render()`.
  > **Order matters:** `TEAM_RESOLVE` runs *before* `PR_GET_OR_CREATE` so a first-time author is
  > latched into their team before the insert (the tightened RLS check needs `my_team_id()` set).
- Re-run triggers: a `tick()` that detects `location.href` changes (SPA nav), a
  `MutationObserver` on `document.body` (catches the sidebar mounting + merge-state flips),
  `visibilitychange`, and a 45s heartbeat while visible and not editing.

**`pr-page.ts`** parses `^https://github.com/([^/]+/[^/]+)/pull/(\d+)` for repo + number, scrapes
the author login and merged state from the DOM. Returns `PrPageInfo { repo, prNumber, authorLogin,
isMerged }`.

**Rendering** is plain DOM into a **shadow root** (style isolation from GitHub). `ensurePanel()`
owns mounting; `render()` clears + repaints; `buildContent()` is the dispatcher that picks a view
from `state`:

| State | View renderer |
|---|---|
| not a PR page / not signed in | static message / "SIGN IN REQUIRED" |
| `state.error && !state.pr` | read-only error banner (this is the **"not in pilot"** state — see §6) |
| author, pool unset | "XP POOL" loading |
| author, open | `renderAuthorOpen` (edit pool; distribute disabled until merged) |
| author, edit mode | `renderEditPool` (0–500 slider, step 10) |
| author, merged, distribute mode | `renderDistribute` (participant % sliders, must sum to 100) |
| distributed | `renderAuthorDistributed` / `renderReviewerWon` |
| reviewer, open/merged | `renderReviewerOpen` |

On a successful distribute, `playLootDrop()` shows a celebration overlay.

#### The floating-panel fallback (critical — do not regress)

`ensurePanel()` calls `findSidebar()` (8 selectors + a "Reviewers"-heading walk-up fallback). If no
sidebar is found, it sets **`state.isFloating = true`** and appends the host to `document.body` with
fixed bottom-right positioning (`z-index: 2147483647`), plus a minimize pill. This guarantees the
widget is reachable even when GitHub's layout changes break anchor detection. This is a deliberate,
**remembered** decision (`feedback_dom_injection_fallback`) — preserve it in any content-script
refactor.

**Theming:** the widget uses the extension's *own* design system in `src/styles/pixel.css`
(`pixel.css?inline` is injected into the shadow root). CSS vars are `--gh-*` / `--xp-*` (currently
dark-tuned, e.g. `--gh-bg:#0d1117`), **not** GitHub's `--color-*` vars. `identicon.ts` makes
deterministic avatars from a login seed.

### 5.2 Popup (`src/popup/popup.ts`, ~540 lines)

Three views via `state.view`: `connect` (signed-out CTA) | `profile` (your XP, rank, PAT input) |
`leaderboard`.

- `refreshAuth()` → `AUTH_GET_USER`; on success switches to `profile` and runs
  `Promise.all([refreshProfileXp(), refreshTokenStatus(), refreshTeam()])`.
- `refreshTeam()` → sends `TEAM_RESOLVE` (latches server-side) then `TEAM_GET`, stores
  `state.team: TeamRow | null`.
- Leaderboard header shows `"${team.name} — GLOBAL TOP 100"`, or the muted hint **"Not in a pilot
  team — ensure your PAT has read:org, or contact your admin."** when `team` is null.
- `loadLeaderboard()` / `LEADERBOARD_GET` is **unchanged** by multi-tenancy — RLS already scopes
  rows to the caller's team; no client-side team filter exists or is needed.
- Token UI: paste PAT → `GH_TOKEN_SET`; `GH_TOKEN_VALIDATE` drives the "VALIDATED AS @login" /
  "REPLACE…" states.

---

## 6. Data model, RLS & the multi-tenancy trust boundary

### 6.1 Tables (final state)

- **`teams`** `(id bigserial, name, github_org unique, created_at)` — seeded manually with pilot
  orgs. **The tenant key.**
- **`profiles`** `(id uuid PK→auth.users, github_login unique, display_name, team_id bigint→teams
  NULLABLE, created_at)`. Created by the `handle_new_user()` trigger on `auth.users` insert.
  `team_id` is null until resolved.
- **`prs`** `(id bigserial, repo, pr_number, author_github_login, xp_pool int≥0 default 100, status
  open|distributed, team_id bigint→teams NOT NULL, created_at, unique(repo,pr_number))`.
- **`xp_grants`** `(id, pr_id→prs, recipient_github_login, points int≥0, percentage 0–100,
  granted_by uuid→profiles, team_id bigint→teams NOT NULL, created_at)` — immutable audit log (no
  update/delete policy).
- **`leaderboard`** view: `select team_id, recipient_github_login, sum(points)::int as total from
  xp_grants group by team_id, recipient_github_login` with **`security_invoker = true`** so the
  caller's `xp_grants` RLS applies to the view automatically.

### 6.2 Triggers & functions

- `handle_new_user()` — `after insert on auth.users`, `security definer`; creates the `profiles`
  row from `user_name`/`preferred_username` + `name`/`full_name`; idempotent.
- `enforce_xp_grants_sum()` — `before update on prs`; on the `open→distributed` flip, raises unless
  the PR's grant percentages sum to exactly 100.
- `prs_set_team()` — `before insert on prs`, `security definer`; derives team from the repo owner,
  raises `check_violation` ("…is not part of the pilot") for unseeded orgs, sets `new.team_id`, and
  latches the author's `profiles.team_id` (`where id = auth.uid() and team_id is null`).
- `xp_grants_set_team()` — `before insert on xp_grants`, `security definer`; copies the parent PR's
  `team_id`.
- `my_team_id()` — `stable security definer` SQL fn returning the caller's `profiles.team_id`.
  Used by every team-scoped policy. `security definer` avoids recursive RLS on `profiles`.

### 6.3 RLS policies (all tables have RLS enabled)

- **Reads (team-scoped):** `profiles_select_team` (`id = auth.uid() or team_id = my_team_id()`),
  `prs_select_team` / `xp_grants_select_team` (`team_id = my_team_id()`), `teams_select_own`
  (`id = my_team_id()`). These replaced the original global `using (true)` policies — that
  replacement *is* the isolation fix.
- **`prs_insert_author`:** JWT login = `author_github_login` **AND** an `exists` check that the
  repo's org (`lower(split_part(repo,'/',1))`) is the caller's team (`my_team_id()`).
- **`prs_update_author`:** JWT login = `author_github_login` (unchanged; select scoping handles
  cross-team).
- **`xp_grants_insert_author_while_open`:** caller is the PR author and `prs.status = 'open'`.
- **`profiles_update_self`:** `id = auth.uid()` for update — enables the `TEAM_RESOLVE` latch from
  the client.
- **JWT login expression** (reuse verbatim everywhere):
  ```sql
  coalesce(auth.jwt() -> 'user_metadata' ->> 'user_name',
           auth.jwt() -> 'user_metadata' ->> 'preferred_username')
  ```

### 6.4 The trust boundary, stated plainly

**`team_id` is never sent by the client and never trusted from it.** The DB computes it (triggers)
and enforces visibility (RLS keyed on `my_team_id()`). The client can only *trigger resolution* of
its own team. This makes cross-tenant spoofing impossible even if the extension is tampered with.

### 6.5 How a user gets a team (two paths)

1. **Org-based (`TEAM_RESOLVE`)** — popup-load and content-`refresh()` send it; background reads the
   PAT, calls `/user/orgs` (**needs `read:org`**), matches `teams.github_org`, updates
   `profiles.team_id`. Covers reviewers who never author.
2. **Authoring (`prs_set_team` latch)** — creating a PR in a seeded org sets the author's
   `team_id`. But the tightened `prs_insert_author` requires `my_team_id()` to already match the
   repo org, which is why content runs `TEAM_RESOLVE` first.

> **Known gap:** no `read:org` ⇒ `/user/orgs` returns `[]` ⇒ `teamResolve` returns null ⇒ the user
> (including a first-time author) cannot be assigned. The design's optional fallback — deriving the
> team from the current PR page's repo owner (`msg.repoOwner`) — is **not implemented**. If pilots
> hit this, implement that fallback in `teamResolve`.

---

## 7. Build, types & packaging

### 7.1 npm scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `vite` | dev server (:5173, HMR :5174), rebuild on change |
| `build` | `vite build && node scripts/patch-manifest.mjs` | bundle to `dist/` + Firefox patch |
| `package` | `npm run build && node scripts/package.mjs` | build + zip to `releases/` |
| `types:db` | `supabase gen types typescript --project-id $SUPABASE_PROJECT_ID --schema public > src/types/database.ts` | regenerate DB types |

### 7.2 Cross-browser manifest (`manifest.config.ts` + `patch-manifest.mjs`)

- `defineManifest` (from `@crxjs/vite-plugin`) declares MV3 with both
  `background.service_worker` (Chrome) and `background.scripts` (Firefox). Each browser ignores the
  field it doesn't use.
- `@crxjs` only emits the Chrome `service_worker` + a `service-worker-loader.js`. After
  `vite build`, **`patch-manifest.mjs`** reads the loader, extracts the hashed background asset name
  (`assets/background.ts-XXXX.js`), and injects `background.scripts: [thatAsset]` into
  `dist/manifest.json` for Firefox. You'll see `patch-manifest: added background.scripts = [...]`
  at the end of every build — that's expected.
- `browser_specific_settings.gecko.id` gives Firefox a stable extension ID (needed for OAuth
  redirect-URL stability). `strict_min_version` 121.
- Permissions: `storage`, `identity`, `activeTab`. Host perms: `github.com`, `api.github.com`,
  `*.supabase.co`. `web_accessible_resources` exposes the two woff2 fonts to `github.com`.

### 7.3 `package.mjs`

Zips the contents of `dist/` (relative paths, `-X` strips OS metadata) into
`releases/review-master-<version>-chrome.zip` and `-firefox.zip`. Both zips are identical content —
the single `dist/manifest.json` already carries both browsers' background keys.

### 7.4 Applying DB migrations

`supabase/migrations/` is applied in timestamp order via `supabase db push` (after `supabase login`
+ project link) or by pasting files in order into the Supabase SQL editor. Then run
`npm run types:db` (needs `SUPABASE_PROJECT_ID` in env + a logged-in CLI) to regenerate
`src/types/database.ts`; if the CLI isn't wired, hand-edit the types to mirror the schema.

> **Migration authoring tip:** prefer idempotent DDL (`create table if not exists`, `add column if
> not exists`, `on conflict … do nothing`) and capture lookup ids into a variable before a backfill
> rather than relying on a subquery returning non-null. The teams migration was reworked to this
> style after a partial-apply left `prs.team_id` null and the `set not null` failed.

---

## 8. Local dev / test loop

```bash
npm install
npm run build                     # → dist/  (re-run, then reload the extension, after each change)
```

**Chrome:** `chrome://extensions` → Developer mode → Load unpacked → `dist/`. After a rebuild click
the ↻ on the card. Inspect the background via the "service worker" link.

**Firefox:** `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `dist/manifest.json`.
After a rebuild click Reload. Inspect the add-on for the background event-page console.

**Console-testing gotcha (Firefox):** `browser.runtime.sendMessage` does **not** deliver to the
context that sent it, and Firefox's popup-inspector quirks make typing into the popup console
unreliable. Don't try to exercise messages from the background console (it can't message itself).
Verify through real UI behavior, or use Chrome's popup Inspect (which keeps the popup context).

No automated tests — verification is manual smoke testing in both browsers (light + dark themes,
seeded vs non-seeded org, floating-panel fallback). The core guarantee to re-check after any
RLS/trigger change is **tenant isolation**: a user in org A must see zero of org B's `prs`,
`xp_grants`, and `leaderboard` rows — verify both through the extension and by querying as each
user's JWT in the SQL editor.

---

## 9. Conventions & gotchas checklist

- **`browser.*` only**, never `chrome.*`.
- Background is an **event page**: top-level listener registration, no persistent globals, state in
  `storage.local` / DB, `alarms` over `setTimeout`.
- Content/popup never touch Supabase — go through messages.
- New backend capability = `Message` variant + router `case` + handler returning `Response<T>`.
- **Never send `team_id` from the client.** Let the triggers set it.
- Two GitHub creds: OAuth session (identity) ≠ PAT (`github_pat`, REST + `read:org`). Keep distinct.
- Keep the **floating-panel fallback** intact in content-script work.
- Migrations: idempotent DDL, sequential `2026MMDD…` prefixes, regenerate types after applying.
- After editing the schema, re-verify **tenant isolation** end-to-end.
- The "not in pilot" / "Not in a pilot team" strings are user-facing and matched by the friendly
  error mapping in `prGetOrCreate` — change them in lockstep.

---

## 10. Pointers

- `CLAUDE.md` — condensed project context (load every session).
- `docs/multi-tenancy-design.md` — locked design for the tenancy model (authoritative for intent).
- `docs/multi-tenancy-implementation-plan.md` — step-by-step rollout with progress checkboxes.
- `ONBOARDING.md` — pilot install + troubleshooting (Chrome + Firefox).
- `.env.example` — the env vars Vite/CLI need (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
  `SUPABASE_PROJECT_ID`).
