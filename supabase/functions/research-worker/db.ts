import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import {
  enqueueContentJob,
} from "./content-job.ts";
import {
  buildProgramCandidate,
} from "./program-candidate.ts";
import {
  prepareProgramInsert,
} from "./program-persistence.ts";
import type {
  ResearchFinding,
  ResearchJob,
} from "./research.ts";

export async function claimResearchJob() {
  const store = createSupabaseJobStore();
  return await store.claim("research");
}

export async function createResearchContentJob(
  job: ResearchJob,
  result: ResearchFinding,
) {
  const store = createSupabaseJobStore();
  return await enqueueContentJob(
    store,
    job,
    result,
  );
}

export async function saveResearchProgramCandidate(
  job: ResearchJob,
  result: ResearchFinding,
) {
  const candidate = buildProgramCandidate(
    job,
    result,
  );

  if (!candidate) {
    return null;
  }

  const client = createSupabaseAdminClient();
  const row = prepareProgramInsert(candidate);

  const { data: inserted, error: insertError } =
    await client
      .from("programs")
      .upsert(row, {
        onConflict: "official_url",
        ignoreDuplicates: true,
      })
      .select(
        "id, name, official_url, affiliate_url, status",
      )
      .maybeSingle();

  if (insertError) {
    throw new Error(
      `Program upsert failed: ${insertError.message}`,
    );
  }

  if (inserted) {
    return {
      ...inserted,
      created: true,
      dedupe_key: candidate._meta.dedupe_key,
    };
  }

  const { data: existing, error: existingError } =
    await client
      .from("programs")
      .select(
        "id, name, official_url, affiliate_url, status",
      )
      .eq("official_url", candidate.official_url)
      .single();

  if (existingError) {
    throw new Error(
      `Program lookup failed: ${existingError.message}`,
    );
  }

  return {
    ...existing,
    created: false,
    dedupe_key: candidate._meta.dedupe_key,
  };
}

export async function completeResearchJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);

  return {
    jobId,
    rpcResult: null,
  };
}

export async function retryResearchJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);

  return {
    jobId,
    rpcResult: null,
  };
}
