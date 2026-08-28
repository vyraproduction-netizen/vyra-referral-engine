import type {
  ResearchJob,
} from "./research-job.ts";

export type JobInsertRow = {
  agent: "research";
  task_type: "topic_research";
  status: "queued";
  priority: number;
  max_attempts: number;
  payload: ResearchJob["payload"] & {
    _meta: {
      dedupe_key: string;
    };
  };
};

export function prepareJobInsert(
  job: ResearchJob,
  dedupeKey: string,
): JobInsertRow {
  return {
    agent: job.agent,
    task_type: job.task_type,
    status: job.status,
    priority: job.priority,
    max_attempts: job.max_attempts,
    payload: {
      ...job.payload,
      _meta: {
        dedupe_key: dedupeKey,
      },
    },
  };
}