-- profiles: one row per signed-in user, keyed off auth.users
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  github_login text not null unique,
  display_name text,
  created_at   timestamptz not null default now()
);

-- prs: a PR is identified by (repo, pr_number); xp_pool is the amount the
-- author committed before merge; status flips to 'distributed' after the
-- author allocates the pool to reviewers.
create table public.prs (
  id                   bigserial primary key,
  repo                 text not null,
  pr_number            int  not null,
  author_github_login  text not null,
  xp_pool              int  not null check (xp_pool >= 0),
  status               text not null default 'open'
                       check (status in ('open', 'distributed')),
  created_at           timestamptz not null default now(),
  unique (repo, pr_number)
);

-- xp_grants: immutable audit log of "author gave N points (P%) to recipient".
-- Multiple rows per PR; their percentages must sum to 100 when status flips
-- to 'distributed' (enforced by a trigger in a later migration).
create table public.xp_grants (
  id                       bigserial primary key,
  pr_id                    bigint not null references public.prs(id) on delete cascade,
  recipient_github_login   text not null,
  points                   int  not null check (points >= 0),
  percentage               int  not null check (percentage between 0 and 100),
  granted_by               uuid not null references public.profiles(id),
  created_at               timestamptz not null default now()
);

create index xp_grants_pr_id_idx        on public.xp_grants(pr_id);
create index xp_grants_recipient_idx    on public.xp_grants(recipient_github_login);
create index prs_author_idx             on public.prs(author_github_login);

-- Auto-create a profile row when a new auth.users row appears (GitHub OAuth).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, github_login, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'preferred_username'),
    coalesce(new.raw_user_meta_data ->> 'name', new.raw_user_meta_data ->> 'full_name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
