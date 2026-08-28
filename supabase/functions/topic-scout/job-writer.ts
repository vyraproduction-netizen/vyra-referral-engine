import type {
  ResearchJob,
} from "./research-job.ts";

export type JobWriteDecision = {
  job: ResearchJob;
  dedupe_key: string;
};

export function prepareResearchJobs(
  jobs: ResearchJob[],
): JobWriteDecision[] {
  const seen = new Set<string>();
  const prepared: JobWriteDecision[] = [];

  for (const job of jobs) {
    const candidateUrl =
      job.payload.candidate.url.trim().toLowerCase();

    const dedupeKey =
      `${job.payload.request_id}:topic_research:${candidateUrl}`;

    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);

    prepared.push({
      job,
      dedupe_key: dedupeKey,
    });
  }

  return prepared;
}