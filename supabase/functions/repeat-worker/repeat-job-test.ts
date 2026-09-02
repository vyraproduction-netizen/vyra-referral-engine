import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  runRepeatJob,
} from "./repeat-job.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function repeatJob(
  taskType: "content_improvement" | "topic_expansion",
): VyraJob {
  const action = taskType === "content_improvement"
    ? "improve_content"
    : "scale_content";

  return {
    id: "00000000-0000-4000-8000-000000005100",
    agent: "repeat",
    task_type: taskType,
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000005101",
      source_job_id: "00000000-0000-4000-8000-000000005102",
      source_content_id:
        "00000000-0000-4000-8000-000000005103",
      referral_link_id:
        "00000000-0000-4000-8000-000000005104",
      optimization: {
        action,
        reason: `Diagnostic ${action}`,
        priority: action === "improve_content" ? 80 : 60,
        conversion_rate: action === "scale_content" ? 0.05 : 0,
        metrics: {
          clicks: 20,
          conversions: action === "scale_content" ? 1 : 0,
          revenue: action === "scale_content" ? 25 : 0,
        },
      },
      _meta: {
        dedupe_key: `repeat:${action}:runtime`,
      },
    },
  };
}

Deno.test("plans a content improvement job", () => {
  const result = runRepeatJob(
    repeatJob("content_improvement"),
  );

  assert(result.execution_status === "planned", "Status mismatch");
  assert(
    result.plan.target.task_type === "content_revision",
    "Revision plan mismatch",
  );
});

Deno.test("plans a topic expansion job", () => {
  const result = runRepeatJob(
    repeatJob("topic_expansion"),
  );

  assert(result.execution_status === "planned", "Status mismatch");
  assert(
    result.plan.target.task_type === "topic_expansion",
    "Expansion plan mismatch",
  );
});

Deno.test("rejects an invalid repeat job", () => {
  const value = {
    ...repeatJob("content_improvement"),
    agent: "optimizer",
  };
  let message = "";

  try {
    runRepeatJob(value);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(message === "Invalid Repeat agent", "Invalid job accepted");
});
