create function public.mark_vyra_cost_reservation_manual_review(
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
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'VYRA manual review reason is required';
  end if;

  update public.vyra_cost_reservations as r
  set
    status = 'manual_review',
    updated_at = now(),
    review_reason = left(v_reason, 1000)
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

  if v_reservation.status <> 'manual_review' then
    raise exception 'VYRA cost reservation cannot be marked for manual review';
  end if;

  return query
  select v_reservation.id, v_reservation.status;
end;
$$;

revoke all on function public.mark_vyra_cost_reservation_manual_review(
  uuid,
  text
) from public, anon, authenticated;

grant execute on function public.mark_vyra_cost_reservation_manual_review(
  uuid,
  text
) to service_role;