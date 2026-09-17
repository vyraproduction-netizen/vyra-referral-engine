-- VYRA paid-provider cost observations. This is an observe-only baseline:
-- it does not schedule work, call providers, or block jobs.

create table public.vyra_cost_budget_policy (
  singleton boolean primary key default true check (singleton),
  currency text not null default 'EUR' check (currency = 'EUR'),
  mode text not null default 'observe' check (mode in ('observe', 'enforce')),
  daily_limit_eur_micros bigint not null check (daily_limit_eur_micros > 0),
  updated_at timestamp with time zone not null default now()
);

insert into public.vyra_cost_budget_policy (
  singleton,
  currency,
  mode,
  daily_limit_eur_micros
)
values (true, 'EUR', 'observe', 450000)
on conflict (singleton) do nothing;

create table public.vyra_cost_observations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  provider text not null check (provider in ('openai', 'tavily')),
  operation text not null check (length(trim(operation)) > 0),
  mode text not null check (mode in ('observe', 'enforce')),
  input_tokens bigint check (input_tokens is null or input_tokens >= 0),
  output_tokens bigint check (output_tokens is null or output_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  estimated_eur_micros bigint check (
    estimated_eur_micros is null or estimated_eur_micros >= 0
  ),
  actual_eur_micros bigint check (
    actual_eur_micros is null or actual_eur_micros >= 0
  ),
  pricing_version text,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamp with time zone not null default now(),
  settled_at timestamp with time zone
);

alter table public.vyra_cost_budget_policy enable row level security;
alter table public.vyra_cost_observations enable row level security;

revoke all privileges on table public.vyra_cost_budget_policy
  from public, anon, authenticated;
revoke all privileges on table public.vyra_cost_observations
  from public, anon, authenticated;

create index vyra_cost_observations_observed_at_idx
  on public.vyra_cost_observations (observed_at desc);
create index vyra_cost_observations_job_provider_idx
  on public.vyra_cost_observations (job_id, provider);

create function public.record_vyra_cost_observation(
  p_job_id uuid,
  p_provider text,
  p_operation text,
  p_input_tokens bigint default null,
  p_output_tokens bigint default null,
  p_total_tokens bigint default null,
  p_estimated_eur_micros bigint default null,
  p_actual_eur_micros bigint default null,
  p_pricing_version text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.vyra_cost_observations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.vyra_cost_budget_policy;
  v_observation public.vyra_cost_observations;
begin
  select * into v_policy
  from public.vyra_cost_budget_policy
  where singleton = true;

  if v_policy.singleton is null then
    raise exception 'VYRA cost budget policy is not configured';
  end if;

  if p_provider not in ('openai', 'tavily') then
    raise exception 'Unsupported cost provider: %', p_provider;
  end if;

  if p_operation is null or length(trim(p_operation)) = 0 then
    raise exception 'Cost operation is required';
  end if;

  if coalesce(p_input_tokens, 0) < 0
    or coalesce(p_output_tokens, 0) < 0
    or coalesce(p_total_tokens, 0) < 0
    or coalesce(p_estimated_eur_micros, 0) < 0
    or coalesce(p_actual_eur_micros, 0) < 0 then
    raise exception 'Cost observation values cannot be negative';
  end if;

  insert into public.vyra_cost_observations (
    job_id,
    provider,
    operation,
    mode,
    input_tokens,
    output_tokens,
    total_tokens,
    estimated_eur_micros,
    actual_eur_micros,
    pricing_version,
    metadata,
    settled_at
  )
  values (
    p_job_id,
    p_provider,
    trim(p_operation),
    v_policy.mode,
    p_input_tokens,
    p_output_tokens,
    p_total_tokens,
    p_estimated_eur_micros,
    p_actual_eur_micros,
    nullif(trim(coalesce(p_pricing_version, '')), ''),
    coalesce(p_metadata, '{}'::jsonb),
    case when p_actual_eur_micros is null then null else now() end
  )
  returning * into v_observation;

  return v_observation;
end;
$$;

create function public.get_vyra_cost_budget_status(
  p_day date default current_date
)
returns table (
  currency text,
  mode text,
  daily_limit_eur_micros bigint,
  observed_calls bigint,
  estimated_eur_micros bigint,
  actual_eur_micros bigint
)
language sql
security definer
set search_path = ''
as $$
  select
    policy.currency,
    policy.mode,
    policy.daily_limit_eur_micros,
    count(observation.id)::bigint as observed_calls,
    coalesce(sum(observation.estimated_eur_micros), 0)::bigint,
    coalesce(sum(observation.actual_eur_micros), 0)::bigint
  from public.vyra_cost_budget_policy as policy
  left join public.vyra_cost_observations as observation
    on observation.observed_at >= p_day::timestamp with time zone
    and observation.observed_at < (p_day + 1)::timestamp with time zone
  where policy.singleton = true
  group by
    policy.currency,
    policy.mode,
    policy.daily_limit_eur_micros;
$$;

revoke all on function public.record_vyra_cost_observation(
  uuid, text, text, bigint, bigint, bigint, bigint, bigint, text, jsonb
) from public, anon, authenticated;
revoke all on function public.get_vyra_cost_budget_status(date)
  from public, anon, authenticated;

grant execute on function public.record_vyra_cost_observation(
  uuid, text, text, bigint, bigint, bigint, bigint, bigint, text, jsonb
) to service_role;
grant execute on function public.get_vyra_cost_budget_status(date)
  to service_role;