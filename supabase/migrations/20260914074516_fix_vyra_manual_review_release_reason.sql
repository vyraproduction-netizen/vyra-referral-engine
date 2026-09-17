create or replace function public.resolve_vyra_cost_manual_review(
  p_reservation_id uuid,
  p_decision text,
  p_reason text
)
returns public.vyra_cost_reservations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_reservation public.vyra_cost_reservations%rowtype;
begin
  if v_decision not in ('settled', 'released') then
    raise exception
      'Manual-review decision must be settled or released';
  end if;

  if v_reason is null then
    raise exception 'Manual-review resolution reason is required';
  end if;

  update public.vyra_cost_reservations as reservation
  set
    status = v_decision,
    updated_at = now(),
    reviewed_at = now(),
    review_reason = v_reason,
    settled_at = case
      when v_decision = 'settled' then now()
      else reservation.settled_at
    end,
    released_at = case
      when v_decision = 'released' then now()
      else reservation.released_at
    end,
    release_reason = case
      when v_decision = 'released' then v_reason
      else reservation.release_reason
    end
  where reservation.id = p_reservation_id
    and reservation.status = 'manual_review'
  returning reservation.* into v_reservation;

  if not found then
    raise exception
      'Manual-review reservation was not found or is already resolved';
  end if;

  return v_reservation;
end;
$$;

revoke all on function public.resolve_vyra_cost_manual_review(
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.resolve_vyra_cost_manual_review(
  uuid,
  text,
  text
) to service_role;