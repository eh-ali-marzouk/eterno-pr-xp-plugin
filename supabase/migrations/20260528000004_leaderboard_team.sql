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
