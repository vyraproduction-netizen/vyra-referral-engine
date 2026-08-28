import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.112.4";
import type {
  CreatedVyraJob,
  JobStore,
  VyraJob,
  VyraJobInput,
} from "./job-store.ts";

export class SupabaseJobStore implements JobStore {
  constructor(private readonly client: SupabaseClient) {}

  async claim(agent: string): Promise<VyraJob | null> {
    const { data, error } = await this.client.rpc("claim_next_job", {
      p_agent: agent,
    });

    if (error) {
      throw new Error(`Job claim failed: ${error.message}`);
    }

    return (data?.[0] as VyraJob | undefined) ?? null;
  }

  async complete(
    jobId: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client.rpc("complete_job", {
      p_job_id: jobId,
      p_status: "completed",
      p_result: result,
      p_error_message: null,
    });

    if (error) {
      throw new Error(`Job completion failed: ${error.message}`);
    }
  }

  async retry(
    jobId: string,
    errorMessage: string,
  ): Promise<void> {
    const { error } = await this.client.rpc("retry_job", {
      p_job_id: jobId,
      p_error_message: errorMessage,
    });

    if (error) {
      throw new Error(`Job retry failed: ${error.message}`);
    }
  }

  async createMany(
    jobs: VyraJobInput[],
  ): Promise<CreatedVyraJob[]> {
    if (jobs.length === 0) {
      return [];
    }

    const { data, error } = await this.client
      .from("jobs")
      .insert(jobs)
      .select("id, payload");

    if (error) {
      throw new Error(`Job insert failed: ${error.message}`);
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      dedupeKey:
        row.payload?._meta?.dedupe_key ?? "",
    }));
  }

  async existsByDedupeKey(
    dedupeKey: string,
  ): Promise<boolean> {
    const { data, error } = await this.client
      .from("jobs")
      .select("id")
      .contains("payload", {
        _meta: {
          dedupe_key: dedupeKey,
        },
      })
      .limit(1);

    if (error) {
      throw new Error(`Job dedupe check failed: ${error.message}`);
    }

    return (data?.length ?? 0) > 0;
  }
}

export function createSupabaseJobStore(): SupabaseJobStore {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  const supabaseKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY");

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required");
  }

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required",
    );
  }

  const client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return new SupabaseJobStore(client);
}
