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
