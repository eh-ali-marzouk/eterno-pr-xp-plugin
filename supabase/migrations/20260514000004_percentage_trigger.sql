-- When a PR's status transitions 'open' -> 'distributed', enforce that the
-- xp_grants percentages for that PR sum to exactly 100. Grants accumulate
-- freely while the PR is open; flipping status is the validation gate.
create or replace function public.enforce_xp_grants_sum()
returns trigger
language plpgsql
as $$
declare
  total int;
begin
  if old.status = 'open' and new.status = 'distributed' then
    select coalesce(sum(percentage), 0) into total
      from public.xp_grants
      where pr_id = new.id;

    if total <> 100 then
      raise exception
        'xp_grants percentages for pr_id=% must sum to 100 (got %)',
        new.id, total;
    end if;
  end if;
  return new;
end;
$$;

create trigger prs_enforce_xp_grants_sum
before update on public.prs
for each row execute function public.enforce_xp_grants_sum();
