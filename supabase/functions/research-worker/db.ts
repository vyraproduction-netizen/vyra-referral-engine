import { createClient } from "jsr:@supabase/supabase-js@2";

export function createResearchJobClient() {
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

  return createClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export async function claimResearchJob() {
  const supabase = createResearchJobClient();

  const { data, error } = await supabase
    .rpc("claim_next_job", {
      p_agent: "research",
    });

  if (error) {
    throw new Error(
      `Research job claim failed: ${error.message}`,
    );
  }

  return data?.[0] ?? null;
}

export async function completeResearchJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const supabase = createResearchJobClient();

  const { data, error } = await supabase
    .rpc("complete_job", {
      p_job_id: jobId,
      p_status: "completed",
      p_result: result,
      p_error_message: null,
    });

  if (error) {
    throw new Error(
      `Research job completion failed: ${error.message}`,
    );
  }

  return {
    jobId,
    rpcResult: data ?? null,
  };
}
export async function retryResearchJob(
  jobId: string,
  errorMessage: string,
) {
  const supabase = createResearchJobClient();

  const { data, error } = await supabase
    .rpc("retry_job", {
      p_job_id: jobId,
      p_error_message: errorMessage,
    });

  if (error) {
    throw new Error(
      `Research job retry failed: ${error.message}`,
    );
  }

  return {
    jobId,
    rpcResult: data ?? null,
  };
}
