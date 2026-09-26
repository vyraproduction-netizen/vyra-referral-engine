create or replace function public.reserve_vyra_cost_budget(
  p_job_id uuid,
  p_provider text,
  p_operation text,
  p_reserved_eur_micros bigint
)
returns table (
  id uuid,
  mode text,
  status text,
  reserved_eur_micros bigint,
  remaining_eur_micros bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.vyra_cost_budget_policy%rowtype;
  v_existing public.vyra_cost_reservations%rowtype;
  v_used_eur_micros bigint;
  v_remaining_eur_micros bigint;
  v_day_utc date := (now() at time zone 'utc')::date;
begin
  if p_provider not in ('openai', 'tavily') then
    raise exception 'Unsupported budget provider: %', p_provider;
  end if;

  if (
    p_provider = 'openai'
    and p_operation not in ('content_draft', 'content_revision')
  ) or (
    p_provider = 'tavily'
    and p_operation not in (
      'topic_scout_search',
      'research_worker_search'
    )
  ) then
    raise exception 'Unsupported budget operation: %', p_operation;
  end if;

  if p_reserved_eur_micros is null
    or p_reserved_eur_micros <= 0 then
    raise exception 'Budget reservation must be positive';
  end if;

  select *
  into v_policy
  from public.vyra_cost_budget_policy
  where singleton = true
  for update;

  if not found then
    raise exception 'VYRA cost budget policy is not configured';
  end if;

  if v_policy.mode <> 'enforce' then
    raise exception 'VYRA cost enforcement is disabled';
  end if;

  select *
  into v_existing
  from public.vyra_cost_reservations as r
  where r.job_id = p_job_id
    and r.provider = p_provider
    and r.operation = p_operation
  for update;

  if found and v_existing.status in ('reserved', 'settled') then
    select coalesce(sum(r.reserved_eur_micros), 0)
    into v_used_eur_micros
    from public.vyra_cost_reservations as r
    where r.day_utc = v_day_utc
      and r.status in ('reserved', 'settled');

    return query
    select
      v_existing.id,
      v_policy.mode,
      v_existing.status,
      v_existing.reserved_eur_micros,
      greatest(
        v_policy.daily_limit_eur_micros - v_used_eur_micros,
        0
      );
    return;
  end if;

  select coalesce(sum(r.reserved_eur_micros), 0)
  into v_used_eur_micros
  from public.vyra_cost_reservations as r
  where r.day_utc = v_day_utc
    and r.status in ('reserved', 'settled');

  if v_used_eur_micros + p_reserved_eur_micros
    > v_policy.daily_limit_eur_micros then
    raise exception
      'VYRA daily budget exceeded: requested %, remaining %',
      p_reserved_eur_micros,
      greatest(
        v_policy.daily_limit_eur_micros - v_used_eur_micros,
        0
      );
  end if;

  if found and v_existing.status = 'released' then
    update public.vyra_cost_reservations
    set
      day_utc = v_day_utc,
      reserved_eur_micros = p_reserved_eur_micros,
      status = 'reserved',
      updated_at = now(),
      settled_at = null,
      released_at = null,
      release_reason = null
    where id = v_existing.id
    returning * into v_existing;
  else
    insert into public.vyra_cost_reservations (
      job_id,
      provider,
      operation,
      day_utc,
      reserved_eur_micros
    )
    values (
      p_job_id,
      p_provider,
      p_operation,
      v_day_utc,
      p_reserved_eur_micros
    )
    returning * into v_existing;
  end if;

  v_remaining_eur_micros :=
    v_policy.daily_limit_eur_micros
    - v_used_eur_micros
    - v_existing.reserved_eur_micros;

  return query
  select
    v_existing.id,
    v_policy.mode,
    v_existing.status,
    v_existing.reserved_eur_micros,
    v_remaining_eur_micros;
end;
$$;