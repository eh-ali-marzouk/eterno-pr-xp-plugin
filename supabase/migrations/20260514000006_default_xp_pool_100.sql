-- Default new PRs to a 100 XP pool instead of 0, and retroactively bump
-- any still-default rows so existing PRs aren't stuck on an empty pool.

alter table public.prs alter column xp_pool set default 100;

update public.prs
   set xp_pool = 100
 where xp_pool = 0
   and status = 'open';
