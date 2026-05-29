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

-- Allow the user to latch their own profiles.team_id from the client (TEAM_RESOLVE).
create policy profiles_update_self
  on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
