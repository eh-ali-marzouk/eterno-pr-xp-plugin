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
