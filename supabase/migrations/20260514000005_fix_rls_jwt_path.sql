-- Supabase puts the GitHub login at jwt.user_metadata.user_name (from
-- raw_user_meta_data when the OAuth provider returns it), not as a top-level
-- JWT claim. The previous migration assumed top-level user_name and so every
-- author-write check returned NULL = NULL → false → RLS denial.
-- Replace the three affected policies with the correct path, defaulting to
-- preferred_username if user_name is absent.

drop policy if exists prs_insert_author                       on public.prs;
drop policy if exists prs_update_author                       on public.prs;
drop policy if exists xp_grants_insert_author_while_open      on public.xp_grants;

create policy prs_insert_author
  on public.prs for insert to authenticated
  with check (
    coalesce(
      auth.jwt() -> 'user_metadata' ->> 'user_name',
      auth.jwt() -> 'user_metadata' ->> 'preferred_username'
    ) = author_github_login
  );

create policy prs_update_author
  on public.prs for update to authenticated
  using (
    coalesce(
      auth.jwt() -> 'user_metadata' ->> 'user_name',
      auth.jwt() -> 'user_metadata' ->> 'preferred_username'
    ) = author_github_login
  )
  with check (
    coalesce(
      auth.jwt() -> 'user_metadata' ->> 'user_name',
      auth.jwt() -> 'user_metadata' ->> 'preferred_username'
    ) = author_github_login
  );

create policy xp_grants_insert_author_while_open
  on public.xp_grants for insert to authenticated
  with check (
    exists (
      select 1 from public.prs p
      where p.id = pr_id
        and p.status = 'open'
        and p.author_github_login = coalesce(
              auth.jwt() -> 'user_metadata' ->> 'user_name',
              auth.jwt() -> 'user_metadata' ->> 'preferred_username'
            )
    )
  );
