import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertRepeatWorkerJob,
  buildRepeatExecutionPlan,
} from "./plan.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function job(
  taskType: "content_improvement" | "topic_expansion",
): VyraJob {
  const action = taskType === "content_improvement"
    ? "improve_content"
    : "scale_content";

  return {
    id: "00000000-0000-4000-8000-000000005000",
    agent: "repeat",
    task_type: taskType,
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000005001",
      source_job_id: "00000000-0000-4000-8000-000000005002",
      source_content_id:
        "00000000-0000-4000-8000-000000005003",
      referral_link_id:
        "00000000-0000-4000-8000-000000005004",
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
        dedupe_key: `repeat:${action}:diagnostic`,
      },
    },
  };
}

Deno.test(
  "builds a content revision plan",
  () => {
    const value = job("content_improvement");
    assertRepeatWorkerJob(value);
    const plan = buildRepeatExecutionPlan(value);

    assert(plan.target.agent === "content", "Unexpected target agent");
    assert(
      plan.target.task_type === "content_revision",
      "Unexpected target task",
    );
    assert(plan.action === "improve_content", "Unexpected action");
  },
);

Deno.test(
  "builds a topic expansion plan",
  () => {
    const value = job("topic_expansion");
    assertRepeatWorkerJob(value);
    const plan = buildRepeatExecutionPlan(value);

    assert(
      plan.target.agent === "topic_scout",
      "Unexpected target agent",
    );
    assert(
      plan.target.task_type === "topic_expansion",
      "Unexpected target task",
    );
    assert(plan.action === "scale_content", "Unexpected action");
  },
);

Deno.test(
  "preserves optimization evidence in the plan",
  () => {
    const value = job("topic_expansion");
    assertRepeatWorkerJob(value);
    const plan = buildRepeatExecutionPlan(value);

    assert(plan.metrics.clicks === 20, "Clicks mismatch");
    assert(plan.metrics.revenue === 25, "Revenue mismatch");
    assert(plan.metrics.conversion_rate === 0.05, "Rate mismatch");
    assert(
      plan.source_content_id === value.payload.source_content_id,
      "Content id mismatch",
    );
  },
);

Deno.test(
  "builds a stable plan dedupe key",
  () => {
    const value = job("content_improvement");
    assertRepeatWorkerJob(value);
    const first = buildRepeatExecutionPlan(value);
    const second = buildRepeatExecutionPlan(value);

    assert(
      first.dedupe_key === second.dedupe_key,
      "Plan dedupe key changed",
    );
  },
);

Deno.test("rejects a foreign agent", () => {
  const value = { ...job("content_improvement"), agent: "content" };

  let message = "";
  try {
    assertRepeatWorkerJob(value);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(message === "Invalid Repeat agent", "Foreign agent accepted");
});

Deno.test("rejects an unsupported task type", () => {
  const value = { ...job("content_improvement"), task_type: "content_draft" };

  let message = "";
  try {
    assertRepeatWorkerJob(value);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(
    message === "Invalid Repeat task_type",
    "Unsupported task type accepted",
  );
});

Deno.test("rejects a mismatched action", () => {
  const value = job("content_improvement");
  const payload = value.payload as Record<string, unknown>;
  const optimization = payload.optimization as Record<string, unknown>;
  optimization.action = "scale_content";

  let message = "";
  try {
    assertRepeatWorkerJob(value);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(
    message === "Repeat task_type does not match optimization action",
    "Mismatched action accepted",
  );
});

Deno.test("requires optimization metrics", () => {
  const value = job("content_improvement");
  const payload = value.payload as Record<string, unknown>;
  const optimization = payload.optimization as Record<string, unknown>;
  delete optimization.metrics;

  let message = "";
  try {
    assertRepeatWorkerJob(value);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  assert(
    message === "Repeat optimization.metrics is required",
    "Missing metrics accepted",
  );
});
