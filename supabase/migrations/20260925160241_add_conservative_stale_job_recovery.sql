-- Recovery is explicitly invoked by a trusted operator or scheduler.
-- Workers that may have reached an external service are held for review.
create function public.recover_stale_vyra_jobs(
  p_min_age_minutes integer default 30,
  p_limit integer default 100
)
returns table (
  job_id uuid,
  agent text,
  recovery_status text,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_min_age_minutes is null or p_min_age_minutes < 15
    or p_min_age_minutes > 1440 then
    raise exception 'Recovery age must be between 15 and 1440 minutes';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Recovery limit must be between 1 and 100';
  end if;

  return query
  with stale as (
    select j.id
    from public.jobs as j
    where j.status = 'running'
      and j.started_at < now() - make_interval(mins => p_min_age_minutes)
    order by j.started_at, j.id
    for update skip locked
    limit p_limit
  ), recovered as (
    update public.jobs as j
    set status = case
        when j.agent in ('qa', 'analytics', 'optimizer', 'repeat')
          and j.attempts < j.max_attempts then 'retry'
        else 'failed'
      end,
      next_run_at = case
        when j.agent in ('qa', 'analytics', 'optimizer', 'repeat')
          and j.attempts < j.max_attempts then now() + interval '5 minutes'
        else j.next_run_at
      end,
      error_message = case
        when j.agent in ('qa', 'analytics', 'optimizer', 'repeat')
          and j.attempts < j.max_attempts
          then 'Stale job recovered; safe internal retry scheduled'
        else 'Stale job stopped; review external side effects before retry'
      end
    from stale
    where j.id = stale.id and j.status = 'running'
    returning j.id, j.agent, j.status, j.attempts
  )
  select r.id, r.agent, r.status, r.attempts
  from recovered as r;
end;
$$;

revoke all on function public.recover_stale_vyra_jobs(integer, integer)
  from public, anon, authenticated;
grant execute on function public.recover_stale_vyra_jobs(integer, integer)
  to service_role;
