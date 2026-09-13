import type {
  CreatedVyraJob,
  JobStore,
} from "../_shared/vyra/job-store.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";
import {
  buildTopicExpansionJob,
} from "./topic-expansion.ts";

type TopicExpansionJobStore = Pick<
  JobStore,
  "createMany" | "existsByDedupeKey"
>;

export type TopicExpansionEnqueueResult = {
  created: boolean;
  reused: boolean;
  dedupe_key: string;
  job: CreatedVyraJob | null;
};

export async function enqueueTopicExpansionJob(
  store: TopicExpansionJobStore,
  plan: RepeatExecutionPlan,
): Promise<TopicExpansionEnqueueResult> {
  const expansionJob = buildTopicExpansionJob(plan);
  const dedupeKey =
    expansionJob.payload._meta.dedupe_key;

  if (await store.existsByDedupeKey(dedupeKey)) {
    return {
      created: false,
      reused: true,
      dedupe_key: dedupeKey,
      job: null,
    };
  }

  const created = await store.createMany([
    expansionJob,
  ]);
  const job = created[0] ?? null;

  if (!job) {
    throw new Error(
      "Topic expansion job was not created",
    );
  }

  if (job.dedupeKey !== dedupeKey) {
    throw new Error(
      "Topic expansion dedupe key was not preserved",
    );
  }

  return {
    created: true,
    reused: false,
    dedupe_key: dedupeKey,
    job,
  };
}
