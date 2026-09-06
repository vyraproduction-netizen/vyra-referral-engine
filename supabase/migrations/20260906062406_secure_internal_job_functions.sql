-- Keep internal queue mutation functions outside the public Data API surface.
revoke all on function public.claim_next_job(text)
  from public, anon, authenticated;
revoke all on function public.complete_job(uuid, text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.retry_job(uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_next_job(text) to service_role;
grant execute on function public.complete_job(uuid, text, jsonb, text) to service_role;
grant execute on function public.retry_job(uuid, text) to service_role;

-- This SECURITY DEFINER diagnostic exposes request context and is not used at runtime.
drop function if exists public.vyra_debug_request_context();

-- Prevent future objects in the exposed public schema from automatically granting
-- access to API roles. Public-facing objects must receive explicit grants instead.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

-- Supabase migrations cannot change supabase_admin's default privileges.
-- Every application-owned public function must still revoke PUBLIC explicitly.
