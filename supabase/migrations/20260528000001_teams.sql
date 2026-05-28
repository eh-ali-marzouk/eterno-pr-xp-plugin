-- Multi-tenancy: a team == a GitHub org (the repo owner).
-- Idempotent: safe to re-run if a prior apply partially succeeded.
create table if not exists public.teams (
  id          bigserial primary key,
  name        text not null,
  github_org  text not null unique,            -- lowercased repo owner, e.g. 'acme'
  created_at  timestamptz not null default now()
);
alter table public.teams enable row level security;

-- Pilot teams. REPLACE the org slugs + display names with the real pilot orgs.
insert into public.teams (name, github_org) values
  ('Acme',   'acme'),
  ('Globex', 'globex')
on conflict (github_org) do nothing;

-- Default team for pre-existing dev data so it is not orphaned.
insert into public.teams (name, github_org) values ('Eterno', 'eterno')
on conflict (github_org) do nothing;

-- Add tenant columns (nullable first, backfill, then tighten).
alter table public.profiles  add column if not exists team_id bigint references public.teams(id);
alter table public.prs       add column if not exists team_id bigint references public.teams(id);
alter table public.xp_grants add column if not exists team_id bigint references public.teams(id);

-- Backfill existing rows to the Eterno default team. Capture the id explicitly
-- so a null lookup raises a clear error instead of silently leaving nulls
-- (which would only surface later at the `set not null` step).
do $$
declare
  v_eterno bigint;
begin
  select id into v_eterno from public.teams where github_org = 'eterno';
  if v_eterno is null then
    raise exception 'Eterno default team (github_org=''eterno'') is missing; cannot backfill team_id';
  end if;
  update public.prs       set team_id = v_eterno where team_id is null;
  update public.xp_grants set team_id = v_eterno where team_id is null;
  update public.profiles  set team_id = v_eterno where team_id is null;
end $$;

-- prs / xp_grants must always belong to a team; profiles.team_id stays nullable
-- (a brand-new user is unassigned until resolved).
alter table public.prs       alter column team_id set not null;
alter table public.xp_grants alter column team_id set not null;

create index if not exists profiles_team_idx  on public.profiles(team_id);
create index if not exists prs_team_idx        on public.prs(team_id);
create index if not exists xp_grants_team_idx  on public.xp_grants(team_id);
