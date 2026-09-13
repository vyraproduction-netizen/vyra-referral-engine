


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent" "text" NOT NULL,
    "task_type" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "priority" integer DEFAULT 100 NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "result" "jsonb",
    "error_message" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "next_run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    CONSTRAINT "jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'retry'::"text"])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_job"("p_agent" "text") RETURNS SETOF "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin

    return query
    update public.jobs
    set
        status = 'running',
        attempts = attempts + 1,
        started_at = now()
    where id = (
        select id
        from public.jobs
        where
            status in ('queued', 'retry')
            and next_run_at <= now()
            and agent = p_agent
            and attempts < max_attempts
        order by priority asc, created_at asc
        for update skip locked
        limit 1
    )
    returning *;

end;
$$;


ALTER FUNCTION "public"."claim_next_job"("p_agent" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_status" "text", "p_result" "jsonb" DEFAULT '{}'::"jsonb", "p_error_message" "text" DEFAULT NULL::"text") RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_job public.jobs;
begin

    if p_status not in ('completed', 'failed', 'retry') then
        raise exception 'Invalid job status: %', p_status;
    end if;

    update public.jobs
    set
        status = p_status,
        result = case
            when p_status = 'completed' then p_result
            else result
        end,
        error_message = case
            when p_status in ('failed', 'retry') then p_error_message
            else null
        end,
        completed_at = case
            when p_status = 'completed' then now()
            else completed_at
        end,
        next_run_at = case
            when p_status = 'retry' then now() + interval '5 minutes'
            else next_run_at
        end
    where id = p_job_id
      and status = 'running'
    returning * into v_job;

    if v_job.id is null then
        raise exception 'Job not found or is not running';
    end if;

    return v_job;

end;
$$;


ALTER FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_status" "text", "p_result" "jsonb", "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."retry_job"("p_job_id" "uuid", "p_error_message" "text") RETURNS "public"."jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
    v_job public.jobs;
begin

    update public.jobs
    set
        error_message = p_error_message,
        status = case
            when attempts >= max_attempts
                then 'failed'
            else 'retry'
        end,
        next_run_at = case
            when attempts >= max_attempts
                then next_run_at
            else now() + interval '5 minutes'
        end
    where id = p_job_id
      and status = 'running'
    returning * into v_job;

    if v_job.id is null then
        raise exception 'Job not found or is not running';
    end if;

    return v_job;

end;
$$;


ALTER FUNCTION "public"."retry_job"("p_job_id" "uuid", "p_error_message" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vyra_debug_request_context"() RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'request_role', current_setting('request.jwt.claim.role', true),
    'request_claims', current_setting('request.jwt.claims', true)
  );
$$;


ALTER FUNCTION "public"."vyra_debug_request_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."vyra_debug_role"() RETURNS "jsonb"
    LANGUAGE "sql"
    AS $$
  select jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'jwt_role', auth.jwt() ->> 'role'
  );
$$;


ALTER FUNCTION "public"."vyra_debug_role"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    "description" "text",
    "enabled" boolean DEFAULT false NOT NULL,
    "max_retries" integer DEFAULT 3 NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."analytics_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" "text" NOT NULL,
    "content_id" "uuid",
    "referral_link_id" "uuid",
    "session_id" "text",
    "country" "text",
    "language" "text",
    "source" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "value" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "analytics_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['view'::"text", 'click'::"text", 'referral_click'::"text", 'conversion'::"text", 'commission'::"text"])))
);


ALTER TABLE "public"."analytics_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic_id" "uuid",
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "content_type" "text" DEFAULT 'article'::"text" NOT NULL,
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "body" "text",
    "excerpt" "text",
    "meta_title" "text",
    "meta_description" "text",
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "qa_score" numeric(5,2),
    "published_url" "text",
    "views" integer DEFAULT 0 NOT NULL,
    "outbound_clicks" integer DEFAULT 0 NOT NULL,
    "conversions" integer DEFAULT 0 NOT NULL,
    "commission" numeric(12,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "published_at" timestamp with time zone,
    CONSTRAINT "content_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'researching'::"text", 'qa'::"text", 'approved'::"text", 'published'::"text", 'rejected'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."content" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."programs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "official_url" "text" NOT NULL,
    "affiliate_url" "text",
    "status" "text" DEFAULT 'candidate'::"text" NOT NULL,
    "countries" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "commission_type" "text",
    "commission_value" numeric(12,2),
    "recurring" boolean DEFAULT false NOT NULL,
    "cookie_duration_days" integer,
    "terms_url" "text",
    "terms_verified" boolean DEFAULT false NOT NULL,
    "last_verified_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "programs_status_check" CHECK (("status" = ANY (ARRAY['candidate'::"text", 'applied'::"text", 'approved'::"text", 'active'::"text", 'paused'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."programs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "program_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "url" "text" NOT NULL,
    "source" "text",
    "placement" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "clicks" integer DEFAULT 0 NOT NULL,
    "conversions" integer DEFAULT 0 NOT NULL,
    "revenue" numeric(12,2) DEFAULT 0 NOT NULL,
    "last_click_at" timestamp with time zone,
    "last_conversion_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "referral_links_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."referral_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."topics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "topic" "text" NOT NULL,
    "slug" "text",
    "language" "text" DEFAULT 'en'::"text" NOT NULL,
    "content_type" "text" DEFAULT 'article'::"text" NOT NULL,
    "search_intent" "text" DEFAULT 'commercial'::"text" NOT NULL,
    "cluster" "text",
    "priority" integer DEFAULT 100 NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "source" "text",
    "evidence" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "discovered_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "topics_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'researching'::"text", 'ready'::"text", 'published'::"text", 'rejected'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."topics" OWNER TO "postgres";


ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."agents"
    ADD CONSTRAINT "agents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."programs"
    ADD CONSTRAINT "programs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_links"
    ADD CONSTRAINT "referral_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."topics"
    ADD CONSTRAINT "topics_pkey" PRIMARY KEY ("id");



CREATE INDEX "agents_enabled_idx" ON "public"."agents" USING "btree" ("enabled");



CREATE INDEX "analytics_events_content_idx" ON "public"."analytics_events" USING "btree" ("content_id");



CREATE INDEX "analytics_events_created_idx" ON "public"."analytics_events" USING "btree" ("created_at");



CREATE INDEX "analytics_events_referral_idx" ON "public"."analytics_events" USING "btree" ("referral_link_id");



CREATE INDEX "analytics_events_type_idx" ON "public"."analytics_events" USING "btree" ("event_type");



CREATE INDEX "content_language_idx" ON "public"."content" USING "btree" ("language");



CREATE INDEX "content_published_at_idx" ON "public"."content" USING "btree" ("published_at");



CREATE INDEX "content_status_idx" ON "public"."content" USING "btree" ("status");



CREATE INDEX "content_topic_idx" ON "public"."content" USING "btree" ("topic_id");



CREATE INDEX "jobs_agent_idx" ON "public"."jobs" USING "btree" ("agent");



CREATE INDEX "jobs_created_at_idx" ON "public"."jobs" USING "btree" ("created_at");



CREATE INDEX "jobs_status_next_run_idx" ON "public"."jobs" USING "btree" ("status", "next_run_at");



CREATE INDEX "programs_name_idx" ON "public"."programs" USING "btree" ("name");



CREATE INDEX "programs_status_idx" ON "public"."programs" USING "btree" ("status");



CREATE INDEX "referral_links_program_idx" ON "public"."referral_links" USING "btree" ("program_id");



CREATE INDEX "referral_links_source_idx" ON "public"."referral_links" USING "btree" ("source");



CREATE INDEX "referral_links_status_idx" ON "public"."referral_links" USING "btree" ("status");



CREATE INDEX "topics_cluster_idx" ON "public"."topics" USING "btree" ("cluster");



CREATE INDEX "topics_language_idx" ON "public"."topics" USING "btree" ("language");



CREATE INDEX "topics_status_priority_idx" ON "public"."topics" USING "btree" ("status", "priority");



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "public"."content"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."analytics_events"
    ADD CONSTRAINT "analytics_events_referral_link_id_fkey" FOREIGN KEY ("referral_link_id") REFERENCES "public"."referral_links"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."content"
    ADD CONSTRAINT "content_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."referral_links"
    ADD CONSTRAINT "referral_links_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE CASCADE;



ALTER TABLE "public"."agents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."content" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."programs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."topics" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_job"("p_agent" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_agent" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_job"("p_agent" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_status" "text", "p_result" "jsonb", "p_error_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_status" "text", "p_result" "jsonb", "p_error_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_job"("p_job_id" "uuid", "p_status" "text", "p_result" "jsonb", "p_error_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."retry_job"("p_job_id" "uuid", "p_error_message" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."retry_job"("p_job_id" "uuid", "p_error_message" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."retry_job"("p_job_id" "uuid", "p_error_message" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."vyra_debug_request_context"() TO "anon";
GRANT ALL ON FUNCTION "public"."vyra_debug_request_context"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."vyra_debug_request_context"() TO "service_role";



GRANT ALL ON FUNCTION "public"."vyra_debug_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."vyra_debug_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."vyra_debug_role"() TO "service_role";


















GRANT ALL ON TABLE "public"."agents" TO "anon";
GRANT ALL ON TABLE "public"."agents" TO "authenticated";
GRANT ALL ON TABLE "public"."agents" TO "service_role";



GRANT ALL ON TABLE "public"."analytics_events" TO "anon";
GRANT ALL ON TABLE "public"."analytics_events" TO "authenticated";
GRANT ALL ON TABLE "public"."analytics_events" TO "service_role";



GRANT ALL ON TABLE "public"."content" TO "anon";
GRANT ALL ON TABLE "public"."content" TO "authenticated";
GRANT ALL ON TABLE "public"."content" TO "service_role";



GRANT ALL ON TABLE "public"."programs" TO "anon";
GRANT ALL ON TABLE "public"."programs" TO "authenticated";
GRANT ALL ON TABLE "public"."programs" TO "service_role";



GRANT ALL ON TABLE "public"."referral_links" TO "anon";
GRANT ALL ON TABLE "public"."referral_links" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_links" TO "service_role";



GRANT ALL ON TABLE "public"."topics" TO "anon";
GRANT ALL ON TABLE "public"."topics" TO "authenticated";
GRANT ALL ON TABLE "public"."topics" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


