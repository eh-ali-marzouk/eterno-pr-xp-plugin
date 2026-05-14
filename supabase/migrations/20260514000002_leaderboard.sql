create view public.leaderboard as
select
  recipient_github_login,
  sum(points)::int as total
from public.xp_grants
group by recipient_github_login;

grant select on public.leaderboard to authenticated;
