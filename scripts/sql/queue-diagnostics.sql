-- VYRA queue diagnostics — READ ONLY
-- Run against local or explicitly approved diagnostic databases.
-- This script does not claim, complete, retry, insert, update, or delete jobs.

begin transaction read only;

-- 1. Queue summary by agent and status.
select
  agent,
  status,
  count(*) as job_count
from public.jobs
group by agent, status
order by agent, status;

-- 2. Jobs ready to be claimed now.
select
  id,
  agent,
  task_type,
  status,
  priority,
  attempts,
  max_attempts,
  next_run_at,
  next_run_at <= now() as ready_now,
  error_message,
  payload->'_meta'->>'dedupe_key' as dedupe_key
from public.jobs
where
  status in ('queued', 'retry')
  and next_run_at <= now()
order by priority asc, created_at asc;

-- 3. Running jobs and their age.
select
  id,
  agent,
  task_type,
  status,
  attempts,
  max_attempts,
  started_at,
  now() - started_at as running_for,
  error_message,
  payload->'_meta'->>'dedupe_key' as dedupe_key
from public.jobs
where status = 'running'
order by started_at asc;

-- 4. Retry jobs and timing.
select
  id,
  agent,
  task_type,
  status,
  attempts,
  max_attempts,
  next_run_at,
  next_run_at <= now() as ready_now,
  extract(epoch from (next_run_at - now())) as seconds_until_ready,
  error_message,
  payload->'_meta'->>'dedupe_key' as dedupe_key
from public.jobs
where status = 'retry'
order by next_run_at asc;

-- 5. Duplicate non-empty dedupe keys.
select
  payload->'_meta'->>'dedupe_key' as dedupe_key,
  count(*) as job_count,
  array_agg(id order by created_at) as job_ids
from public.jobs
where nullif(payload->'_meta'->>'dedupe_key', '') is not null
group by payload->'_meta'->>'dedupe_key'
having count(*) > 1
order by job_count desc, dedupe_key;

-- 6. RPC identity and security mode, without exposing function bodies.
select
  n.nspname as function_schema,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where
  n.nspname = 'public'
  and p.proname in (
    'claim_next_job',
    'complete_job',
    'retry_job'
  )
order by p.proname, arguments;

-- 7. Jobs and agents table shapes, without reading agents table rows.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where
  table_schema = 'public'
  and table_name in ('jobs', 'agents')
order by table_name, ordinal_position;

-- 8. Public schema table inventory.
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;

-- 9. Database clock used for retry comparisons.
select now() as db_now;

rollback;
