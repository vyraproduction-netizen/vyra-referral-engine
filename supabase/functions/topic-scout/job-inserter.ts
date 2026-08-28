import type {
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import { createSupabaseJobStore } from "../_shared/vyra/supabase-job-store.ts";

import type {
  JobInsertRow,
} from "./db-writer.ts";

export type InsertedJob = {
  id: string;
  dedupe_key: string;
};

export async function insertResearchJobs(
  rows: JobInsertRow[],
): Promise<InsertedJob[]> {
  if (rows.length === 0) {
    return [];
  }

  const store = createSupabaseJobStore();

  const jobs: VyraJobInput[] = rows.map((row) => ({
    agent: row.agent,
    task_type: row.task_type,
    status: row.status,
    priority: row.priority,
    max_attempts: row.max_attempts,
    payload: row.payload,
  }));

  const createdJobs = await store.createMany(jobs);

  return createdJobs.map((job) => ({
    id: job.id,
    dedupe_key: job.dedupeKey,
  }));
}
