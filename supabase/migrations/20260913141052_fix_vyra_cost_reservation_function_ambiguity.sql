create or replace function public.settle_vyra_cost_reservation(
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
    status = 'settled',
    updated_at = now(),
    settled_at = coalesce(r.settled_at, now())
  where r.id = p_reservation_id
    and r.status = 'reserved'
  returning r.* into v_reservation;

  if not found then
    select r.*
    into v_reservation
    from public.vyra_cost_reservations as r
    where r.id = p_reservation_id;

    if not found then
      raise exception 'VYRA cost reservation was not found';
    end if;

    if v_reservation.status <> 'settled' then
      raise exception 'VYRA cost reservation cannot be settled';
    end if;
  end if;

  return query
  select v_reservation.id, v_reservation.status;
end;
$$;

create or replace function public.release_vyra_cost_reservation(
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
  update public.vyra_cost_reservations as r
  set
    status = 'released',
    updated_at = now(),
    released_at = now(),
    release_reason = nullif(trim(coalesce(p_reason, '')), '')
  where r.id = p_reservation_id
    and r.status = 'reserved'
  returning r.* into v_reservation;

  if not found then
    select r.*
    into v_reservation
    from public.vyra_cost_reservations as r
    where r.id = p_reservation_id;

    if not found then
      raise exception 'VYRA cost reservation was not found';
    end if;

    if v_reservation.status <> 'released' then
      raise exception 'VYRA cost reservation cannot be released';
    end if;
  end if;

  return query
  select v_reservation.id, v_reservation.status;
end;
$$;