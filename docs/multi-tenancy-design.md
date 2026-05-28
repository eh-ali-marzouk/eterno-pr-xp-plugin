# Solution Design — Multi-Tenancy for PR XP (Review-Master)

> **Audience:** an implementing AI agent (or engineer). This document is self-contained and
> prescriptive. Follow it top-to-bottom. Code excerpts are reference implementations — match the
> surrounding code's style. Do **not** invent scope beyond what is written here.

---

## 1. Goal & Constraints

Turn the single-tenant extension into a **multi-tenant** one so the two pilot companies have fully
isolated data. Company A must never read Company B's PRs, XP grants, profiles, or leaderboard.

**Product decisions already locked (do not re-litigate):**

| Decision | Choice |
|---|---|
| Tenant identity | **GitHub org** = the repo owner. `acme/backend` → team `acme`. |
| Teams per user | **Exactly one.** Stored as `profiles.team_id`. |
| Leaderboard | **Per-team only.** No cross-company board. |
| Team provisioning | **Manual SQL seed** of the two pilot orgs. No team-creation UI. |
| Enforcement | **Postgres RLS keyed on `team_id`.** The client is untrusted. |
| Deliverable | A pilot `ONBOARDING.md` at repo root. |

**Non-goals:** team-creation UI, multi-team membership, cross-tenant global board, GitLab/Bitbucket,
publishing to web stores. Keep the existing architecture conventions in `CLAUDE.md` (content script
never holds the Supabase client; all DB access via `browser.runtime.sendMessage` to background;
`browser.*` polyfill; GitHub CSS vars in injected UI).

---

## 2. Current State (verified — read before editing)

- **Schema** (`supabase/migrations/`):
  - `20260514000001_init.sql` — `profiles(id uuid pk → auth.users, github_login unique, display_name,
    created_at)`, `prs(id bigserial, repo, pr_number, author_github_login, xp_pool int≥0,
    status open|distributed, unique(repo,pr_number))`, `xp_grants(id, pr_id fk, recipient_github_login,
    points int≥0, percentage 0-100, granted_by uuid fk profiles, created_at)`. Plus
    `handle_new_user()` trigger that auto-creates a `profiles` row on `auth.users` insert, reading
    `raw_user_meta_data ->> 'user_name' | 'preferred_username'`.
  - `20260514000002_leaderboard.sql` — `create view leaderboard as select recipient_github_login,
    sum(points) total from xp_grants group by 1` (global, no team).
  - `20260514000003_rls.sql` — RLS on all 3 tables. **All three `select` policies are `using (true)`**
    (the single-tenant leak we are closing). Writes: `prs_insert_author`, `prs_update_author`,
    `xp_grants_insert_author_while_open`.
  - `20260514000005_fix_rls_jwt_path.sql` — the canonical JWT login expression to **reuse verbatim**:
    ```sql
    coalesce(auth.jwt() -> 'user_metadata' ->> 'user_name',
             auth.jwt() -> 'user_metadata' ->> 'preferred_username')
    ```
  - `20260514000006_default_xp_pool_100.sql` — pool default 100.
- **Background** (`src/background/background.ts`, 270 lines): message router + handlers. Relevant:
  `prGetOrCreate` (select by repo+pr_number; insert if caller is author, default pool 100; handles
  23505 race), `prSetPool`, `prFetchParticipants` (GitHub API via PAT), `prDistribute` (insert grants,
  flip status), `prListGrants`, `leaderboardGet` (`select recipient_github_login, total from
  leaderboard order by total desc`), `currentGithubLogin()` helper, `getUser()`.
- **Messages** (`src/lib/messages.ts`): the discriminated `Message` union, `Response<T> = {ok:true,
  data?:T} | {ok:false,error}`, `PrRow`, `GrantInput`, `GrantRow`, `LeaderboardRow`, `TokenStatus`.
- **GitHub lib** (`src/lib/github.ts`): `validateToken`, `ghFetch<T>(path, token)` (GET, bearer,
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`), `fetchPrParticipants`.
  PAT stored in `browser.storage.local` key `github_pat`.
- **Popup** (`src/popup/popup.ts`, 520 lines): `connect | profile | leaderboard` views;
  `loadLeaderboard()` sends `LEADERBOARD_GET`; `refreshProfileXp()` finds the user's rank.
- **Content** (`src/content/content.ts`, 1147 lines): widget on PR pages; `refresh()` calls
  `PR_GET_OR_CREATE`; keep the floating-panel fallback (see memory `feedback_dom_injection_fallback`).

---

## 3. Architecture of the Change

```
┌────────────────────────────────────────────────────────────────────┐
│  Postgres (Supabase) — the ONLY trust boundary                       │
│                                                                      │
│  teams(id, name, github_org unique)  ← seeded manually               │
│                                                                      │
│  profiles.team_id ─┐   prs.team_id ─┐   xp_grants.team_id ─┐         │
│                    └── all FK → teams.id                    │         │
│                                                             │         │
│  team_id is set SERVER-SIDE:                                          │
│   • prs:       BEFORE INSERT trigger derives team from repo owner    │
│   • xp_grants: BEFORE INSERT trigger copies parent pr.team_id        │
│   • profiles:  latched by the prs trigger (authors) AND by           │
│                TEAM_RESOLVE via GitHub /user/orgs (reviewers)         │
│                                                                      │
│  RLS: every select/insert is scoped by my_team_id() = the caller's   │
│       profiles.team_id.  leaderboard view runs security_invoker.     │
└────────────────────────────────────────────────────────────────────┘
            ▲ sendMessage                         ▲ sendMessage
   ┌────────┴────────┐                   ┌─────────┴─────────┐
   │ content script  │                   │      popup        │
   │ TEAM_RESOLVE on │                   │ TEAM_RESOLVE +    │
   │ refresh()       │                   │ TEAM_GET on load  │
   └─────────────────┘                   └───────────────────┘
```

**Key principle:** `team_id` is never sent by the client. The DB computes and enforces it. The client
only triggers *resolution* of the caller's own `profiles.team_id`. This makes spoofing impossible.

---

## 4. Database Migrations

Create four new files. Use the next sequential date prefix `20260528`. Apply in order.

### 4.1 `supabase/migrations/20260528000001_teams.sql`

```sql
-- Multi-tenancy: a team == a GitHub org (the repo owner).
create table public.teams (
  id          bigserial primary key,
  name        text not null,
  github_org  text not null unique,            -- lowercased repo owner, e.g. 'acme'
  created_at  timestamptz not null default now()
);
alter table public.teams enable row level security;

-- Pilot teams. REPLACE the org slugs + display names with the real pilot orgs.
insert into public.teams (name, github_org) values
  ('Acme',   'acme'),
  ('Globex', 'globex');

-- Default team for pre-existing dev data so it is not orphaned.
insert into public.teams (name, github_org) values ('Eterno', 'eterno');

-- Add tenant columns (nullable first, backfill, then tighten).
alter table public.profiles  add column team_id bigint references public.teams(id);
alter table public.prs       add column team_id bigint references public.teams(id);
alter table public.xp_grants add column team_id bigint references public.teams(id);

-- Backfill existing rows to the Eterno default team.
update public.prs       set team_id = (select id from public.teams where github_org = 'eterno') where team_id is null;
update public.xp_grants set team_id = (select id from public.teams where github_org = 'eterno') where team_id is null;
update public.profiles  set team_id = (select id from public.teams where github_org = 'eterno') where team_id is null;

-- prs / xp_grants must always belong to a team; profiles.team_id stays nullable
-- (a brand-new user is unassigned until resolved).
alter table public.prs       alter column team_id set not null;
alter table public.xp_grants alter column team_id set not null;

create index profiles_team_idx  on public.profiles(team_id);
create index prs_team_idx        on public.prs(team_id);
create index xp_grants_team_idx  on public.xp_grants(team_id);
```

> **Note for the implementer:** if the target Supabase project has no existing data you care about,
> you may drop the `'Eterno'` seed + backfill — but keeping it is harmless and protects dev rows.

### 4.2 `supabase/migrations/20260528000002_team_triggers.sql`

```sql
-- Derive prs.team_id from the repo owner, reject non-pilot orgs, and latch the
-- author's profile team. security definer so it can write profiles under RLS.
create or replace function public.prs_set_team()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org  text := lower(split_part(new.repo, '/', 1));
  v_team bigint;
begin
  select id into v_team from public.teams where github_org = v_org;
  if v_team is null then
    raise exception 'Org "%" is not part of the pilot', v_org
      using errcode = 'check_violation';
  end if;
  new.team_id := v_team;
  update public.profiles
     set team_id = v_team
   where id = auth.uid() and team_id is null;
  return new;
end;
$$;

create trigger prs_set_team_before_insert
  before insert on public.prs
  for each row execute function public.prs_set_team();

-- xp_grants inherit the parent PR's team.
create or replace function public.xp_grants_set_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.team_id := (select team_id from public.prs where id = new.pr_id);
  return new;
end;
$$;

create trigger xp_grants_set_team_before_insert
  before insert on public.xp_grants
  for each row execute function public.xp_grants_set_team();
```

### 4.3 `supabase/migrations/20260528000003_rls_team_scope.sql`

```sql
-- Caller's team, evaluated as definer to avoid recursive RLS on profiles.
create or replace function public.my_team_id()
returns bigint language sql stable security definer set search_path = public as $$
  select team_id from public.profiles where id = auth.uid()
$$;

-- teams: a user may read only their own team row.
create policy teams_select_own
  on public.teams for select to authenticated
  using (id = public.my_team_id());

-- Replace the global select policies with team-scoped ones.
drop policy if exists profiles_select_authenticated  on public.profiles;
drop policy if exists prs_select_authenticated        on public.prs;
drop policy if exists xp_grants_select_authenticated  on public.xp_grants;

create policy profiles_select_team
  on public.profiles for select to authenticated
  using (id = auth.uid() or team_id = public.my_team_id());

create policy prs_select_team
  on public.prs for select to authenticated
  using (team_id = public.my_team_id());

create policy xp_grants_select_team
  on public.xp_grants for select to authenticated
  using (team_id = public.my_team_id());

-- Tighten prs insert: still author-only, AND the repo's org must be the caller's team.
drop policy if exists prs_insert_author on public.prs;
create policy prs_insert_author
  on public.prs for insert to authenticated
  with check (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'user_name',
             auth.jwt() -> 'user_metadata' ->> 'preferred_username') = author_github_login
    and exists (
      select 1 from public.teams t
      where t.github_org = lower(split_part(repo, '/', 1))
        and t.id = public.my_team_id()
    )
  );

-- prs_update_author and xp_grants_insert_author_while_open from
-- 20260514000005_fix_rls_jwt_path.sql remain correct: they filter by PR
-- authorship, and the new select scoping prevents cross-team visibility.
-- Leave them unchanged.
```

> **Edge case the implementer must understand:** the `prs_insert_author` check above requires the
> author's `profiles.team_id` to already equal the repo's org team (`my_team_id()`). For a *brand-new
> author* whose `team_id` is still null, this check fails and the trigger-latch never runs. Resolve by
> ensuring `TEAM_RESOLVE` (section 6) runs **before** the first PR insert — the content script calls
> it in `refresh()` prior to `PR_GET_OR_CREATE`. As a safety net, `TEAM_RESOLVE` can also derive the
> team from the *current PR page's repo owner* when GitHub `/user/orgs` is unavailable (PAT lacks
> `read:org`); see 6.3.

### 4.4 `supabase/migrations/20260528000004_leaderboard_team.sql`

```sql
-- Recreate the leaderboard with team_id and security_invoker so the caller's
-- xp_grants RLS scoping applies automatically (Supabase is PG15+).
drop view if exists public.leaderboard;
create view public.leaderboard with (security_invoker = true) as
  select team_id,
         recipient_github_login,
         sum(points)::int as total
  from public.xp_grants
  group by team_id, recipient_github_login;

grant select on public.leaderboard to authenticated;
```

---

## 5. Type Regeneration

After migrations are applied to the Supabase project:

```bash
npm run types:db   # supabase gen types ... > src/types/database.ts
```

This adds the `teams` table, `team_id` columns on `profiles`/`prs`/`xp_grants`, and the new
`leaderboard` shape (`team_id`, `recipient_github_login`, `total`). If the Supabase CLI/env is not
wired locally, hand-edit `src/types/database.ts` to mirror the schema above.

---

## 6. Backend Changes (`src/`)

### 6.1 `src/lib/messages.ts`

Add to the `Message` union:

```ts
  | { type: 'TEAM_GET' }
  | { type: 'TEAM_RESOLVE' }
```

Add types:

```ts
export type TeamRow = {
  id: number
  name: string
  github_org: string
}
```

Add optional `team_id?: number` to `LeaderboardRow` (cosmetic; the query is already scoped by RLS).

### 6.2 `src/lib/github.ts`

Add (reuse the existing `ghFetch` helper):

```ts
// Orgs the PAT's user belongs to. Requires the `read:org` scope; returns [] if
// the token lacks it (caller falls back to repo-owner derivation).
export async function fetchUserOrgs(token: string): Promise<string[]> {
  try {
    const orgs = await ghFetch<Array<{ login: string }>>('/user/orgs?per_page=100', token)
    return orgs.map((o) => o.login.toLowerCase())
  } catch {
    return []
  }
}
```

### 6.3 `src/background/background.ts`

Add switch cases:

```ts
      case 'TEAM_GET':
        return teamGet()
      case 'TEAM_RESOLVE':
        return teamResolve(msg)
```

Add handlers:

```ts
async function teamGet(): Promise<Response<TeamRow | null>> {
  const { data: me } = await supabase.auth.getUser()
  const uid = me.user?.id
  if (!uid) return { ok: true, data: null }
  const { data, error } = await supabase
    .from('profiles')
    .select('team_id, teams ( id, name, github_org )')
    .eq('id', uid)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  const team = (data?.teams ?? null) as TeamRow | null
  return { ok: true, data: team }
}

// Resolve and latch the caller's profiles.team_id.
// Strategy: (1) if already set, return it; (2) match a GitHub org from /user/orgs
// against teams.github_org; (3) optional fallback: derive from a repo owner the
// caller is currently viewing (passed in msg.repoOwner) — covers PATs without read:org.
async function teamResolve(_msg: Extract<Message, { type: 'TEAM_RESOLVE' }>): Promise<Response<TeamRow | null>> {
  const { data: me } = await supabase.auth.getUser()
  const uid = me.user?.id
  if (!uid) return { ok: true, data: null }

  // Already resolved?
  const existing = await teamGet()
  if (existing.ok && existing.data) return existing

  const token = await getStoredToken()
  if (!token) return { ok: true, data: null }

  const orgs = await fetchUserOrgs(token)          // lowercased
  if (orgs.length === 0) return { ok: true, data: null }

  // Find the first pilot team matching one of the user's orgs.
  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, name, github_org')
    .in('github_org', orgs)
  if (error) return { ok: false, error: error.message }
  const team = (teams?.[0] ?? null) as TeamRow | null
  if (!team) return { ok: true, data: null }

  const upd = await supabase.from('profiles').update({ team_id: team.id }).eq('id', uid)
  if (upd.error) return { ok: false, error: upd.error.message }
  return { ok: true, data: team }
}
```

> **RLS note:** `profiles_select_team` allows `id = auth.uid()`, so `teamGet` can read the caller's
> own row even before a team is set. The `profiles` table needs an **update policy** for the user's
> own row so `teamResolve` can latch it from the client. Add to migration 4.3:
> ```sql
> create policy profiles_update_self
>   on public.profiles for update to authenticated
>   using (id = auth.uid()) with check (id = auth.uid());
> ```
> (Keep this — without it the client-side latch in `teamResolve` is denied and only the PR-insert
> trigger latch works.)

`prGetOrCreate` / `prDistribute` need **no `team_id` logic** — the DB triggers set it. Optionally map
the trigger's `check_violation` error to a friendlier message: if `inserted.error.message` contains
`not part of the pilot`, return `{ ok: false, error: 'Your GitHub org is not part of the pilot.' }`.

### 6.4 Imports

`background.ts` already imports from `../lib/github`; add `fetchUserOrgs`. Add `TeamRow` to the
`messages` import. Import `Message` is already present for the router.

---

## 7. Frontend Changes

### 7.1 Popup (`src/popup/popup.ts`)

- On load (after `AUTH_GET_USER` succeeds), send `TEAM_RESOLVE`, then `TEAM_GET`.
- Render the team name in the leaderboard header: e.g. `"${team.name} — Top Reviewers"`. If
  `team` is null, render a hint: `"Not in a pilot team — ensure your PAT has read:org, or contact
  your admin."`
- `loadLeaderboard()` / `LEADERBOARD_GET` is **unchanged** — RLS already scopes rows to the team.

### 7.2 Content script (`src/content/content.ts`)

- In `refresh()`, send `TEAM_RESOLVE` **before** `PR_GET_OR_CREATE` so a first-time author is latched
  prior to the insert (see edge case in 4.3).
- Handle the "org not in pilot" error from `PR_GET_OR_CREATE`: show a small read-only message in the
  widget, do not crash, keep the existing floating-panel fallback.

---

## 8. Deliverable: `ONBOARDING.md` (repo root)

Write a pilot install guide containing:

1. **Install (Chrome):** load the packaged build — `npm run package` produces
   `releases/review-master-<version>-chrome.zip`; unzip + Load Unpacked at `chrome://extensions`,
   or install the provided `.crx`.
2. **Sign in** with GitHub via the popup (OAuth).
3. **Add a GitHub token:** create a PAT (classic with `read:user` + **`read:org`**, or a fine-grained
   token with equivalent read access) and paste it into the popup once. `read:org` is what lets the
   extension auto-detect your team.
4. **Team auto-detection:** explain that the team is derived from your GitHub org — nothing to
   configure. If you only review (never author) PRs, `read:org` is required for detection.
5. **Daily use:** set an XP pool on your PR → after merge, distribute XP by percentage → view your
   team leaderboard in the popup.
6. **Troubleshooting:** "Not in a pilot team" → PAT missing `read:org`, or your org isn't seeded
   (admin must add it to the `teams` table). "Org not part of the pilot" on a PR → same cause.

---

## 9. Verification (must pass before calling done)

1. **Migrations apply** cleanly in order against a Supabase branch/local; `teams` has the pilot rows;
   `team_id` columns, triggers, `my_team_id()`, and the new policies/view exist.
2. **Isolation (core guarantee):** as a user in org A, create a PR in `A/repo` and distribute XP.
   As a user in org B, confirm `prs`, `xp_grants`, and `leaderboard` return **zero** A rows — verify
   both through the extension and by querying as each user's JWT in the Supabase SQL editor.
3. **Reviewer derivation:** a user who never authored a PR signs in with a `read:org` PAT →
   `TEAM_RESOLVE` sets `profiles.team_id` → they see their team's leaderboard.
4. **Author derivation + trigger guard:** authoring a PR in a seeded org latches `team_id`; authoring
   in a **non-seeded** org is rejected with a clear error and the widget shows the "not in pilot"
   state.
5. **Build:** `npm run build` and `npm run package` succeed; load `dist/` in Chrome; popup leaderboard
   header shows the team name.
6. **Regression:** backfilled `eterno` dev data still appears for the developer's own account; no
   cross-team bleed.

---

## 10. File Manifest

| File | Action |
|---|---|
| `supabase/migrations/20260528000001_teams.sql` | new — table, columns, seed, backfill, not-null |
| `supabase/migrations/20260528000002_team_triggers.sql` | new — `prs_set_team`, `xp_grants_set_team` |
| `supabase/migrations/20260528000003_rls_team_scope.sql` | new — `my_team_id`, scoped policies, `profiles_update_self` |
| `supabase/migrations/20260528000004_leaderboard_team.sql` | new — team-scoped `leaderboard` view |
| `src/types/database.ts` | regenerate (`npm run types:db`) |
| `src/lib/messages.ts` | add `TEAM_GET`/`TEAM_RESOLVE`, `TeamRow`, `LeaderboardRow.team_id?` |
| `src/lib/github.ts` | add `fetchUserOrgs` |
| `src/background/background.ts` | add `teamGet`, `teamResolve` + switch cases; friendlier trigger error |
| `src/popup/popup.ts` | resolve team on load; show team name in header |
| `src/content/content.ts` | `TEAM_RESOLVE` before `PR_GET_OR_CREATE`; handle "not in pilot" |
| `ONBOARDING.md` | new — pilot install guide |

---

## 11. Implementation Order (suggested)

1. Migrations 4.1 → 4.4 (+ `profiles_update_self` policy). Apply, then `npm run types:db`.
2. `messages.ts` types → `github.ts` `fetchUserOrgs` → `background.ts` handlers.
3. Popup, then content script.
4. `ONBOARDING.md`.
5. Run section 9 verification end-to-end.
```
