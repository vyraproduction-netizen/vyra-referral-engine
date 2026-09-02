import {
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";

export async function claimRepeatJob() {
  const store = createSupabaseJobStore();
  return await store.claim("repeat");
}

export async function completeRepeatJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);
}

export async function retryRepeatJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);
}
