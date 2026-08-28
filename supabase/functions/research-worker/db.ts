import { createSupabaseJobStore } from "../_shared/vyra/supabase-job-store.ts";

export async function claimResearchJob() {
  const store = createSupabaseJobStore();
  return await store.claim("research");
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
