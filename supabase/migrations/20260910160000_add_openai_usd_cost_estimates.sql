-- Native USD estimates for OpenAI usage. EUR budget policy remains unchanged.
alter table public.vyra_cost_observations
  add column estimated_usd_micros bigint,
  add column actual_usd_micros bigint,
  add constraint vyra_cost_observations_estimated_usd_micros_nonnegative
    check (estimated_usd_micros is null or estimated_usd_micros >= 0),
  add constraint vyra_cost_observations_actual_usd_micros_nonnegative
    check (actual_usd_micros is null or actual_usd_micros >= 0);

create or replace function public.record_vyra_cost_observation_usd(
  p_job_id uuid, p_provider text, p_operation text,
  p_input_tokens bigint default null, p_output_tokens bigint default null,
  p_total_tokens bigint default null, p_estimated_usd_micros bigint default null,
  p_actual_usd_micros bigint default null, p_pricing_version text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (id uuid, mode text)
language plpgsql security definer set search_path = ''
as $$
declare v_policy public.vyra_cost_budget_policy%rowtype; v_id uuid;
begin
  select * into v_policy from public.vyra_cost_budget_policy where currency = 'EUR' for update;
  if not found then raise exception 'VYRA cost policy is not configured'; end if;
  if p_provider <> 'openai' or p_operation not in ('content_draft', 'content_revision') then
    raise exception 'Unsupported USD cost observation';
  end if;
  if p_input_tokens is not null and p_input_tokens < 0 or p_output_tokens is not null and p_output_tokens < 0
    or p_total_tokens is not null and p_total_tokens < 0 or p_estimated_usd_micros is not null and p_estimated_usd_micros < 0
    or p_actual_usd_micros is not null and p_actual_usd_micros < 0 then
    raise exception 'Cost observation values must be non-negative';
  end if;
  insert into public.vyra_cost_observations (
    job_id, provider, operation, mode, input_tokens, output_tokens, total_tokens,
    estimated_eur_micros, actual_eur_micros, estimated_usd_micros, actual_usd_micros, pricing_version, metadata
  ) values (
    p_job_id, p_provider, p_operation, v_policy.mode, p_input_tokens, p_output_tokens, p_total_tokens,
    null, null, p_estimated_usd_micros, p_actual_usd_micros, p_pricing_version, coalesce(p_metadata, '{}'::jsonb)
  ) returning vyra_cost_observations.id into v_id;
  return query select v_id, v_policy.mode;
end;
$$;

revoke all on function public.record_vyra_cost_observation_usd(uuid, text, text, bigint, bigint, bigint, bigint, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_vyra_cost_observation_usd(uuid, text, text, bigint, bigint, bigint, bigint, bigint, text, jsonb) to service_role;
