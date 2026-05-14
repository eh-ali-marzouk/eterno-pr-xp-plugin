alter table public.profiles  enable row level security;
alter table public.prs       enable row level security;
alter table public.xp_grants enable row level security;

-- Anyone authenticated can read everything.
create policy profiles_select_authenticated
  on public.profiles for select to authenticated using (true);

create policy prs_select_authenticated
  on public.prs for select to authenticated using (true);

create policy xp_grants_select_authenticated
  on public.xp_grants for select to authenticated using (true);

-- prs insert/update: only the PR's author (matched by github login in JWT).
create policy prs_insert_author
  on public.prs for insert to authenticated
  with check (auth.jwt() ->> 'user_name' = author_github_login);

create policy prs_update_author
  on public.prs for update to authenticated
  using      (auth.jwt() ->> 'user_name' = author_github_login)
  with check (auth.jwt() ->> 'user_name' = author_github_login);

-- xp_grants insert: only allowed when the inserter is the PR's author AND
-- the PR is still 'open'. No update/delete policies → grants are immutable.
create policy xp_grants_insert_author_while_open
  on public.xp_grants for insert to authenticated
  with check (
    exists (
      select 1 from public.prs p
      where p.id = pr_id
        and p.author_github_login = auth.jwt() ->> 'user_name'
        and p.status = 'open'
    )
  );
