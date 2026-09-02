import type {
  OptimizationDecision,
} from "./optimizer.ts";
import {
  buildRepeatJob,
  type RepeatJob,
  type RepeatSource,
} from "./repeat.ts";

export type CreatedRepeatJob = {
  id: string;
  dedupeKey: string;
};

export type RepeatJobStore = {
  existsByDedupeKey(
    dedupeKey: string,
  ): Promise<boolean>;
  createMany(
    jobs: RepeatJob[],
  ): Promise<CreatedRepeatJob[]>;
};

export async function enqueueRepeatJobs(
  store: RepeatJobStore,
  source: RepeatSource,
  decisions: OptimizationDecision[],
): Promise<CreatedRepeatJob[]> {
  const pending: RepeatJob[] = [];
  const seen = new Set<string>();

  for (const decision of decisions) {
    const job = buildRepeatJob(source, decision);

    if (!job) {
      continue;
    }

    const dedupeKey = job.payload._meta.dedupe_key;

    if (
      seen.has(dedupeKey) ||
      await store.existsByDedupeKey(dedupeKey)
    ) {
      continue;
    }

    seen.add(dedupeKey);
    pending.push(job);
  }

  return pending.length === 0
    ? []
    : await store.createMany(pending);
}
