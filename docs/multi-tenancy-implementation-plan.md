# Implementation Plan — Multi-Tenancy for PR XP (Review-Master)

> **For the implementing AI agent.** Execute top-to-bottom. Each step references the
> authoritative solution design in [`docs/multi-tenancy-design.md`](./multi-tenancy-design.md)
> — read the cited section before writing code, and match its reference implementations
> exactly. Do **not** add scope beyond what the design specifies.
>
> **Cross-browser rule:** this extension ships for **Chrome and Firefox** from one codebase.
> Every code step must be validated in **both** browsers before its checkbox is ticked. A
> "🧪 Test in both browsers" reminder closes each step.
>
> **Architecture invariants (from `CLAUDE.md` — never violate):**
> - Content script never holds the Supabase client; all DB access goes through
>   `browser.runtime.sendMessage` to the background.
> - Use `browser.*` (webextension-polyfill), never `chrome.*`.
> - Injected UI uses GitHub CSS vars (`var(--color-canvas-default)` etc.).
> - Background is an event page: top-level listeners, no persistent globals.
> - `team_id` is **never** sent by the client. The DB derives and enforces it.

---

## How to test in Chrome and Firefox (reference — used by every step)

Run a build first; both browsers load from the same `dist/`.

```bash
npm run build      # vite build + manifest patch
# or, for an active edit loop:
npm run dev        # rebuilds on change
```

**Chrome**
1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. **Load unpacked** → select the `dist/` folder. (First time only.)
4. After each rebuild, click the **↻ reload** icon on the PR XP card.
5. Open DevTools on the background service worker via the **"service worker"** link on the card to read logs.

**Firefox**
1. Go to `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on** → select `dist/manifest.json`. (First time only.)
3. After each rebuild, click **Reload** next to the add-on.
4. Use **Inspect** on the add-on to open the background event-page console.

**For every UI/behavior step, in BOTH browsers:**
- Reload the extension, then hard-reload a GitHub PR page (`github.com/<owner>/<repo>/pull/<n>`).
- Open the popup and the on-page widget; confirm no console errors in the background or content contexts.
- Confirm light **and** dark GitHub themes still render correctly (injected UI uses GitHub CSS vars).

> Migration/DB-only steps can't be "loaded" in a browser, but their effect (team scoping,
> leaderboard shape) must still be verified through the extension in both browsers once the
> backend wiring lands — see Step 9.

---

## Step 0 — Branch & baseline

- [x] Create a working branch off `main` (e.g. `feat/multi-tenancy`). — created `feat/multi-tenancy`
- [x] Confirm a clean `npm run build` succeeds **before** any changes (baseline). — clean build verified
- [x] Confirm Supabase access: either the Supabase CLI is wired (`SUPABASE_PROJECT_ID` set, `npm run types:db` runs) or you have SQL-editor access to the project. Note which, since it changes Step 1 and Step 4. — CLI installed locally; `SUPABASE_PROJECT_ID` lives in `.env.local` (not in shell env), so `npm run types:db` needs env loaded + Supabase login/access token. Applying migrations & type-gen will need user-side Supabase access.

🧪 **Test in both browsers:** Load the unmodified `dist/` in Chrome and Firefox per the reference above. Confirm the existing widget + popup leaderboard work today. This is your regression baseline.

---

## Step 1 — Database migrations (design §4)

Create four migration files under `supabase/migrations/` with the `20260528` prefix, **applied in order**. Copy the SQL verbatim from the design; do not improvise.

- [x] **§4.1** `20260528000001_teams.sql` — `teams` table, pilot seed (replace `acme`/`globex` slugs + names with the **real pilot orgs**), `eterno` default-team seed, add nullable `team_id` to `profiles`/`prs`/`xp_grants`, backfill to `eterno`, set `team_id NOT NULL` on `prs`/`xp_grants` (profiles stays nullable), create the three `*_team_idx` indexes. — written verbatim; placeholders `acme`/`globex` kept per user decision.
- [x] **§4.2** `20260528000002_team_triggers.sql` — `prs_set_team()` (derives team from `lower(split_part(repo,'/',1))`, rejects non-pilot orgs with `check_violation`, latches author's `profiles.team_id`) + its BEFORE INSERT trigger; `xp_grants_set_team()` (copies parent PR's `team_id`) + its trigger.
- [x] **§4.3** `20260528000003_rls_team_scope.sql` — `my_team_id()` (security definer); `teams_select_own`; drop the three `*_select_authenticated` policies and replace with team-scoped `profiles_select_team` / `prs_select_team` / `xp_grants_select_team`; tighten `prs_insert_author` (author **and** repo org == caller's team). **Also add the `profiles_update_self` policy from the §6.3 RLS note** — without it the client-side team latch in Step 4 is denied. — `profiles_update_self` included.
- [x] **§4.4** `20260528000004_leaderboard_team.sql` — drop & recreate `leaderboard` with `team_id` and `with (security_invoker = true)`; `grant select ... to authenticated`.
- [x] Apply all four in order against the Supabase project (local/branch first if available). Confirm: `teams` has the pilot rows; `team_id` columns, triggers, `my_team_id()`, the new policies, and the new view all exist. — applied cleanly by user (migration 1 reworked to be idempotent + bulletproof first).

🧪 **Test in both browsers:** No browser-loadable change yet. Instead verify in the Supabase SQL editor that migrations applied cleanly and the objects above exist. Do **not** rebuild/reload the extension yet — the generated types are stale until Step 2, and the UI is unwired until Steps 4–6.

---

## Step 2 — Regenerate DB types (design §5)

- [x] Run `npm run types:db` to regenerate `src/types/database.ts` (adds `teams`, the `team_id` columns, and the new `leaderboard` shape `team_id, recipient_github_login, total`). — done by user; CLI was wired.
- [x] If the Supabase CLI/env isn't wired, hand-edit `src/types/database.ts` to mirror the schema from §4 exactly. — N/A, CLI gen succeeded.
- [x] Confirm `npm run build` type-checks against the regenerated types. — clean build.

🧪 **Test in both browsers:** Build and reload `dist/` in Chrome and Firefox. No behavior change is expected yet — this step's goal is **no new console errors / no type regressions** in either browser's background and content contexts.

---

## Step 3 — Messages + GitHub lib (design §6.1, §6.2)

- [ ] **§6.1** `src/lib/messages.ts`: add `{ type: 'TEAM_GET' }` and `{ type: 'TEAM_RESOLVE' }` to the `Message` union; add the `TeamRow` type (`id`, `name`, `github_org`); add optional `team_id?: number` to `LeaderboardRow`.
- [ ] **§6.2** `src/lib/github.ts`: add `fetchUserOrgs(token)` reusing `ghFetch`; it returns lowercased org logins and `[]` on failure (PAT lacks `read:org`).
- [ ] Confirm `npm run build` compiles.

🧪 **Test in both browsers:** Build and reload in Chrome and Firefox. These are type/helper additions with no UI wiring yet — confirm the extension still loads cleanly and the existing widget + popup behave exactly as the Step 0 baseline in **both** browsers.

---

## Step 4 — Background handlers (design §6.3, §6.4)

- [ ] **§6.4** Imports: add `fetchUserOrgs` to the `../lib/github` import; add `TeamRow` to the `messages` import.
- [ ] **§6.3** Add switch cases `TEAM_GET → teamGet()` and `TEAM_RESOLVE → teamResolve(msg)` to the router.
- [ ] Add `teamGet()` — reads the caller's own `profiles` row joined to `teams` (allowed by `profiles_select_team`'s `id = auth.uid()` clause).
- [ ] Add `teamResolve(msg)` — return early if already resolved; else match `fetchUserOrgs` against `teams.github_org`, then latch via `profiles.update({team_id}).eq('id', uid)` (requires `profiles_update_self` from Step 1).
- [ ] Map the trigger's `check_violation` error to a friendly message: if an insert error contains `not part of the pilot`, return `{ ok: false, error: 'Your GitHub org is not part of the pilot.' }`.
- [ ] Confirm `prGetOrCreate` / `prDistribute` were **not** given any `team_id` logic — the DB triggers own it.

🧪 **Test in both browsers:** Build and reload. In **each** browser's background console, manually exercise the new messages, e.g.:
```js
await browser.runtime.sendMessage({ type: 'TEAM_RESOLVE' })
await browser.runtime.sendMessage({ type: 'TEAM_GET' })
```
Signed in with a `read:org` PAT, both should resolve/return your team. Verify in the Supabase SQL editor that your `profiles.team_id` got latched. Confirm identical behavior in Chrome and Firefox.

---

## Step 5 — Popup (design §7.1)

- [ ] On load, after `AUTH_GET_USER` succeeds, send `TEAM_RESOLVE` then `TEAM_GET`.
- [ ] Render the team name in the leaderboard header (e.g. `"${team.name} — Top Reviewers"`).
- [ ] When `team` is null, render the hint: `"Not in a pilot team — ensure your PAT has read:org, or contact your admin."`
- [ ] Leave `loadLeaderboard()` / `LEADERBOARD_GET` **unchanged** — RLS already scopes rows.

🧪 **Test in both browsers:** Build and reload. Open the popup in **both** Chrome and Firefox: confirm the header shows your team name and the leaderboard lists only your team's rows. Temporarily test the null state (e.g. a token without `read:org` on an account with no resolvable team) and confirm the hint renders. Check light + dark themes.

---

## Step 6 — Content script (design §7.2)

- [ ] In `refresh()`, send `TEAM_RESOLVE` **before** `PR_GET_OR_CREATE` (latches a first-time author before the PR insert — see the §4.3 edge case).
- [ ] Handle the "org not in pilot" error from `PR_GET_OR_CREATE`: show a small read-only message in the widget, do **not** crash, and keep the existing floating-panel fallback (memory: `feedback_dom_injection_fallback`).
- [ ] Confirm `npm run build` compiles.

🧪 **Test in both browsers:** Build and reload. On a PR in a **seeded** org, confirm the widget loads and the XP pool works in **both** browsers. On a PR in a **non-seeded** org, confirm the friendly "not in pilot" read-only state shows and nothing crashes. Verify the floating-panel fallback still appears when the primary anchor is missing — in both Chrome and Firefox.

---

## Step 7 — `ONBOARDING.md` deliverable (design §8)

- [ ] Create `ONBOARDING.md` at repo root covering: Install (Chrome **and** Firefox), GitHub OAuth sign-in, adding a PAT with **`read:org`**, team auto-detection explanation, daily use, and troubleshooting ("Not in a pilot team" / "Org not part of the pilot").
- [ ] Ensure the install section gives **both** Chrome (`npm run package` → `releases/review-master-<version>-chrome.zip`, Load Unpacked) **and** Firefox (Load Temporary Add-on at `about:debugging`) instructions — the design's §8 text leans Chrome; add the Firefox path to match this extension's dual-browser support.

🧪 **Test in both browsers:** Follow your own `ONBOARDING.md` from scratch — do a clean install in Chrome and in Firefox exactly as written. Fix any step that doesn't work in either browser.

---

## Step 8 — Build & package (design §9.5)

- [ ] `npm run build` succeeds.
- [ ] `npm run package` succeeds and produces the release zip(s) in `releases/`.

🧪 **Test in both browsers:** Install the **packaged** output (not just the dev `dist/`) — unzip the Chrome release and Load Unpacked in Chrome; Load Temporary Add-on from the packaged build in Firefox. Confirm the popup leaderboard header shows the team name in both.

---

## Step 9 — Verification: tenant isolation & regression (design §9)

Run the full §9 checklist. The core guarantee is **isolation** — verify it both through the extension and by querying as each user's JWT in the Supabase SQL editor.

- [ ] **§9.1 Migrations** apply cleanly in order; all objects exist (confirmed in Step 1).
- [ ] **§9.2 Isolation (core):** as a user in org A, create a PR in `A/repo` and distribute XP. As a user in org B, confirm `prs`, `xp_grants`, and `leaderboard` return **zero** A rows — via the extension **and** via SQL.
- [ ] **§9.3 Reviewer derivation:** a user who never authored a PR signs in with a `read:org` PAT → `TEAM_RESOLVE` sets `profiles.team_id` → they see their team's leaderboard.
- [ ] **§9.4 Author derivation + trigger guard:** authoring in a seeded org latches `team_id`; authoring in a **non-seeded** org is rejected with a clear error and the widget shows the "not in pilot" state.
- [ ] **§9.5 Build:** covered by Step 8.
- [ ] **§9.6 Regression:** backfilled `eterno` dev data still appears for the developer's own account; no cross-team bleed.

🧪 **Test in both browsers:** Execute §9.2, §9.3, and §9.4 end-to-end in **both** Chrome and Firefox (the isolation guarantee must hold identically regardless of browser). Confirm no console errors in either browser's background or content contexts throughout.

---

## File manifest (design §10) — tick as completed

- [x] `supabase/migrations/20260528000001_teams.sql` (new)
- [x] `supabase/migrations/20260528000002_team_triggers.sql` (new)
- [x] `supabase/migrations/20260528000003_rls_team_scope.sql` (new — incl. `profiles_update_self`)
- [x] `supabase/migrations/20260528000004_leaderboard_team.sql` (new)
- [x] `src/types/database.ts` (regenerated)
- [ ] `src/lib/messages.ts` (`TEAM_GET`/`TEAM_RESOLVE`, `TeamRow`, `LeaderboardRow.team_id?`)
- [ ] `src/lib/github.ts` (`fetchUserOrgs`)
- [ ] `src/background/background.ts` (`teamGet`, `teamResolve`, switch cases, friendly error)
- [ ] `src/popup/popup.ts` (resolve team on load; team name in header)
- [ ] `src/content/content.ts` (`TEAM_RESOLVE` before `PR_GET_OR_CREATE`; "not in pilot" state)
- [ ] `ONBOARDING.md` (new — pilot install guide, Chrome **and** Firefox)
