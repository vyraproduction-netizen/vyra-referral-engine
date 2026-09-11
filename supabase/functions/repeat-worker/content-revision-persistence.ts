import type {
  CreatedVyraJob,
  JobStore,
} from "../_shared/vyra/job-store.ts";
import {
  buildContentRevisionJob,
} from "./content-revision.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";

type ContentRevisionJobStore = Pick<
  JobStore,
  "createMany" | "existsByDedupeKey"
>;

export type ContentRevisionEnqueueResult = {
  created: boolean;
  reused: boolean;
  dedupe_key: string;
  job: CreatedVyraJob | null;
};

export async function enqueueContentRevisionJob(
  store: ContentRevisionJobStore,
  plan: RepeatExecutionPlan,
): Promise<ContentRevisionEnqueueResult> {
  const revisionJob = buildContentRevisionJob(plan);
  const dedupeKey =
    revisionJob.payload._meta.dedupe_key;

  if (await store.existsByDedupeKey(dedupeKey)) {
    return {
      created: false,
      reused: true,
      dedupe_key: dedupeKey,
      job: null,
    };
  }

  const created = await store.createMany([
    revisionJob,
  ]);
  const job = created[0] ?? null;

  if (!job) {
    throw new Error(
      "Content revision job was not created",
    );
  }

  if (job.dedupeKey !== dedupeKey) {
    throw new Error(
      "Content revision dedupe key was not preserved",
    );
  }

  return {
    created: true,
    reused: false,
    dedupe_key: dedupeKey,
    job,
  };
}
