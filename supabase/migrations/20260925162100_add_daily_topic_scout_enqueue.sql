-- The scheduler is deliberately not installed or activated here.
-- Calls for the same UTC day have one persistent identity across restarts.
create unique index jobs_daily_scout_schedule_key_idx
  on public.jobs ((payload->>'schedule_key'))
  where agent = 'topic_scout' and payload ? 'schedule_key';

create function public.enqueue_daily_vyra_scout(
  p_topic_seed text default null
)
returns table (job_id uuid, created boolean, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_key text := 'vyra-daily-topic-scout:' || v_day::text;
  v_seed text;
  v_existing uuid;
  v_new uuid;
begin
  v_seed := coalesce(nullif(trim(p_topic_seed), ''),
    case when extract(doy from v_day)::integer % 2 = 0
      then 'image enhancement' else 'video enhancement' end);
  if length(v_seed) > 120 then
    raise exception 'Topic seed is too long';
  end if;

  -- Serialize competing schedulers, including a retry after a timeout.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('vyra-daily-topic-scout')
  );

  select j.id into v_existing
  from public.jobs as j
  where j.agent = 'topic_scout' and j.payload->>'schedule_key' = v_key;
  if v_existing is not null then
    return query select v_existing, false, 'already_created'::text;
    return;
  end if;

  -- A failed worker must be inspected; do not build an unattended backlog.
  if exists (
    select 1 from public.jobs as j
    where j.status in ('queued', 'retry', 'running')
  ) then
    return query select null::uuid, false, 'queue_busy'::text;
    return;
  end if;

  v_new := pg_catalog.gen_random_uuid();
  insert into public.jobs (
    id, agent, task_type, status, priority, payload, max_attempts
  ) values (
    v_new, 'topic_scout', 'topic_discovery', 'queued', 100000,
    pg_catalog.jsonb_build_object(
      'request_id', v_new::text,
      'language', 'en',
      'region', 'EU',
      'topic_seed', v_seed,
      'schedule_key', v_key,
      'constraints', pg_catalog.jsonb_build_object(
        'min_score', 0.7, 'max_topics', 3
      )
    ),
    3
  );
  return query select v_new, true, 'created'::text;
end;
$$;

revoke all on function public.enqueue_daily_vyra_scout(text)
  from public, anon, authenticated;
grant execute on function public.enqueue_daily_vyra_scout(text)
  to service_role;
