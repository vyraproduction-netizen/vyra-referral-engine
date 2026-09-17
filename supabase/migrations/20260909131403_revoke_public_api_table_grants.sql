-- Internal VYRA tables are accessed only by Edge Functions and trusted
-- server-side tooling. Public Data API roles must not access them.

revoke all privileges on all tables in schema public
from anon, authenticated;

revoke all privileges on all sequences in schema public
from anon, authenticated;

alter default privileges for role postgres in schema public
revoke all privileges on tables
from anon, authenticated;

alter default privileges for role postgres in schema public
revoke all privileges on sequences
from anon, authenticated;