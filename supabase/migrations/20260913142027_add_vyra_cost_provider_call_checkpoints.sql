alter table public.vyra_cost_reservations
  drop constraint vyra_cost_reservations_status_check;

alter table public.vyra_cost_reservations
  add constraint vyra_cost_reservations_status_check
  check (
    status in (
      'reserved',
      'in_flight',
      'settled',
      'released',
      'manual_review'
    )
  );

alter table public.vyra_cost_reservations
  add column provider_call_started_at timestamp with time zone,
  add column provider_response_received_at timestamp with time zone,
  add column provider_result jsonb,
  add column review_reason text,
  add column reviewed_at timestamp with time zone;

create index vyra_cost_reservations_recovery_idx
  on public.vyra_cost_reservations (status, updated_at)
  where status in ('in_flight', 'manual_review');

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

  select r.*
  into v_existing
  from public.vyra_cost_reservations as r
  where r.job_id = p_job_id
    and r.provider = p_provider
    and r.operation = p_operation
  for update;

  if found and v_existing.status <> 'released' then
    select coalesce(sum(r.reserved_eur_micros), 0)
    into v_used_eur_micros
    from public.vyra_cost_reservations as r
    where r.day_utc = v_day_utc
      and r.status in ('reserved', 'in_flight', 'settled');

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
    and r.status in ('reserved', 'in_flight', 'settled');

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
    update public.vyra_cost_reservations as r
    set
      day_utc = v_day_utc,
      reserved_eur_micros = p_reserved_eur_micros,
      status = 'reserved',
      updated_at = now(),
      settled_at = null,
      released_at = null,
      release_reason = null,
      provider_call_started_at = null,
      provider_response_received_at = null,
      provider_result = null,
      review_reason = null,
      reviewed_at = null
    where r.id = v_existing.id
    returning r.* into v_existing;
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

create function public.begin_vyra_cost_provider_call(
  p_reservation_id uuid
)
returns table (
  id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.vyra_cost_reservations%rowtype;
begin
  update public.vyra_cost_reservations as r
  set
    status = 'in_flight',
    provider_call_started_at = now(),
    updated_at = now()
  where r.id = p_reservation_id
    and r.status = 'reserved'
  returning r.* into v_reservation;

  if found then
    return query
    select v_reservation.id, v_reservation.status;
    return;
  end if;

  select r.*
  into v_reservation
  from public.vyra_cost_reservations as r
  where r.id = p_reservation_id
  for update;

  if not found then
    raise exception 'VYRA cost reservation was not found';
  end if;

  if v_reservation.status = 'in_flight' then
    update public.vyra_cost_reservations as r
    set
      status = 'manual_review',
      updated_at = now(),
      review_reason = 'Provider response is unknown after an interrupted call'
    where r.id = v_reservation.id
    returning r.* into v_reservation;
  end if;

  return query
  select v_reservation.id, v_reservation.status;
end;
$$;

create function public.checkpoint_vyra_cost_provider_result(
  p_reservation_id uuid,
  p_provider_result jsonb
)
returns table (
  id uuid,
  status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reservation public.vyra_cost_reservations%rowtype;
begin
  if p_provider_result is null then
    raise exception 'VYRA provider result is required';
  end if;

  update public.vyra_cost_reservations as r
  set
    status = 'settled',
    provider_result = p_provider_result,
    provider_response_received_at = now(),
    settled_at = now(),
    updated_at = now()
  where r.id = p_reservation_id
    and r.status = 'in_flight'
  returning r.* into v_reservation;

  if found then
    return query
    select v_reservation.id, v_reservation.status;
    return;
  end if;

  select r.*
  into v_reservation
  from public.vyra_cost_reservations as r
  where r.id = p_reservation_id;

  if not found then
    raise exception 'VYRA cost reservation was not found';
  end if;

  if v_reservation.status <> 'settled' then
    raise exception 'VYRA cost reservation cannot be checkpointed';
  end if;

  return query
  select v_reservation.id, v_reservation.status;
end;
$$;

create function public.load_vyra_cost_provider_result(
  p_reservation_id uuid
)
returns table (
  id uuid,
  status text,
  provider_result jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  select
    r.id,
    r.status,
    r.provider_result
  from public.vyra_cost_reservations as r
  where r.id = p_reservation_id;
end;
$$;

revoke all on function public.begin_vyra_cost_provider_call(uuid)
  from public, anon, authenticated;

revoke all on function public.checkpoint_vyra_cost_provider_result(uuid, jsonb)
  from public, anon, authenticated;

revoke all on function public.load_vyra_cost_provider_result(uuid)
  from public, anon, authenticated;

grant execute on function public.begin_vyra_cost_provider_call(uuid)
  to service_role;

grant execute on function public.checkpoint_vyra_cost_provider_result(uuid, jsonb)
  to service_role;

grant execute on function public.load_vyra_cost_provider_result(uuid)
  to service_role;