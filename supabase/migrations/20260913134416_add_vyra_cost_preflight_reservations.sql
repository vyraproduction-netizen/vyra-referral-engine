-- VYRA preflight budget guard for paid provider calls.
-- A reservation is required before Tavily or OpenAI is invoked.

create table public.vyra_cost_reservations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  provider text not null check (provider in ('openai', 'tavily')),
  operation text not null check (length(trim(operation)) > 0),
  day_utc date not null default ((now() at time zone 'utc')::date),
  reserved_eur_micros bigint not null check (reserved_eur_micros > 0),
  status text not null default 'reserved'
    check (status in ('reserved', 'settled', 'released')),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  settled_at timestamp with time zone,
  released_at timestamp with time zone,
  release_reason text,
  unique (job_id, provider, operation)
);

alter table public.vyra_cost_reservations enable row level security;

revoke all privileges on table public.vyra_cost_reservations
  from public, anon, authenticated;

create index vyra_cost_reservations_day_status_idx
  on public.vyra_cost_reservations (day_utc, status);

create function public.reserve_vyra_cost_budget(
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
  from public.vyra_cost_reservations
  where job_id = p_job_id
    and provider = p_provider
    and operation = p_operation
  for update;

  if found and v_existing.status in ('reserved', 'settled') then
    select coalesce(sum(reserved_eur_micros), 0)
    into v_used_eur_micros
    from public.vyra_cost_reservations
    where day_utc = v_day_utc
      and status in ('reserved', 'settled');

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

  select coalesce(sum(reserved_eur_micros), 0)
  into v_used_eur_micros
  from public.vyra_cost_reservations
  where day_utc = v_day_utc
    and status in ('reserved', 'settled');

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

create function public.settle_vyra_cost_reservation(
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
  update public.vyra_cost_reservations
  set
    status = 'settled',
    updated_at = now(),
    settled_at = coalesce(settled_at, now())
  where id = p_reservation_id
    and status = 'reserved'
  returning * into v_reservation;

  if not found then
    select *
    into v_reservation
    from public.vyra_cost_reservations
    where id = p_reservation_id;

    if not found then
      raise exception 'VYRA cost reservation was not found';
    end if;

    if v_reservation.status <> 'settled' then
      raise exception 'VYRA cost reservation cannot be settled';
    end if;
  end if;

  return query select v_reservation.id, v_reservation.status;
end;
$$;

create function public.release_vyra_cost_reservation(
  p_reservation_id uuid,
  p_reason text
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
  update public.vyra_cost_reservations
  set
    status = 'released',
    updated_at = now(),
    released_at = now(),
    release_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_reservation_id
    and status = 'reserved'
  returning * into v_reservation;

  if not found then
    select *
    into v_reservation
    from public.vyra_cost_reservations
    where id = p_reservation_id;

    if not found then
      raise exception 'VYRA cost reservation was not found';
    end if;

    if v_reservation.status <> 'released' then
      raise exception 'VYRA cost reservation cannot be released';
    end if;
  end if;

  return query select v_reservation.id, v_reservation.status;
end;
$$;

revoke all on function public.reserve_vyra_cost_budget(
  uuid, text, text, bigint
) from public, anon, authenticated;

revoke all on function public.settle_vyra_cost_reservation(
  uuid
) from public, anon, authenticated;

revoke all on function public.release_vyra_cost_reservation(
  uuid, text
) from public, anon, authenticated;

grant execute on function public.reserve_vyra_cost_budget(
  uuid, text, text, bigint
) to service_role;

grant execute on function public.settle_vyra_cost_reservation(
  uuid
) to service_role;

grant execute on function public.release_vyra_cost_reservation(
  uuid, text
) to service_role;