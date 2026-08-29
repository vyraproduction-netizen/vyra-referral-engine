import { createSupabaseJobStore } from "../_shared/vyra/supabase-job-store.ts";
import {
  enqueueContentJob,
} from "./content-job.ts";
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
