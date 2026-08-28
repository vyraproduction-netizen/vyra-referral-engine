import type {
  ResearchJob,
} from "./research-job.ts";

export type ExistingJobChecker = (
  dedupeKey: string,
) => Promise<boolean>;

export async function filterNewResearchJobs(
  jobs: Array<{
    job: ResearchJob;
    dedupe_key: string;
  }>,
  exists: ExistingJobChecker,
) {
  const result: Array<{
    job: ResearchJob;
    dedupe_key: string;
  }> = [];

  for (const item of jobs) {
    const alreadyExists = await exists(item.dedupe_key);

    if (alreadyExists) {
      continue;
    }

    result.push(item);
  }

  return result;
}