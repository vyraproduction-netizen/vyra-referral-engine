import {
  buildRepeatJob,
} from "./repeat.ts";
import type {
  OptimizationAction,
  OptimizationDecision,
} from "./optimizer.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const source = {
  job_id: "00000000-0000-4000-8000-000000003000",
  request_id: "00000000-0000-4000-8000-000000003001",
};

function decision(
  action: OptimizationAction,
): OptimizationDecision {
  return {
    content_id: "00000000-0000-4000-8000-000000003010",
    referral_link_id:
      "00000000-0000-4000-8000-000000003011",
    action,
    reason: `Diagnostic ${action}`,
    priority: action === "improve_content" ? 80 : 60,
    conversion_rate: action === "scale_content" ? 0.05 : 0,
    metrics: {
      clicks: 20,
      conversions: action === "scale_content" ? 1 : 0,
      revenue: action === "scale_content" ? 25 : 0,
    },
  };
}

Deno.test(
  "routes improve_content to a content improvement job",
  () => {
    const job = buildRepeatJob(
      source,
      decision("improve_content"),
    );

    assert(job, "Expected an improvement job");
    assert(job.agent === "repeat", "Unexpected agent");
    assert(
      job.task_type === "content_improvement",
      "Unexpected task type",
    );
    assert(job.priority === 80, "Priority was not preserved");
  },
);

Deno.test(
  "routes scale_content to a topic expansion job",
  () => {
    const job = buildRepeatJob(
      source,
      decision("scale_content"),
    );

    assert(job, "Expected a scaling job");
    assert(job.agent === "repeat", "Unexpected agent");
    assert(
      job.task_type === "topic_expansion",
      "Unexpected task type",
    );
    assert(job.priority === 60, "Priority was not preserved");
  },
);

for (
  const action of [
    "skip",
    "collect_more_data",
    "monitor",
  ] as const
) {
  Deno.test(`does not repeat the ${action} action`, () => {
    assert(
      buildRepeatJob(source, decision(action)) === null,
      `${action} unexpectedly created a job`,
    );
  });
}

Deno.test(
  "builds a stable dedupe key for the same metrics",
  () => {
    const first = buildRepeatJob(
      source,
      decision("improve_content"),
    );
    const second = buildRepeatJob(
      {
        job_id: "00000000-0000-4000-8000-000000003099",
        request_id: "00000000-0000-4000-8000-000000003098",
      },
      decision("improve_content"),
    );

    assert(first && second, "Expected repeat jobs");
    assert(
      first.payload._meta.dedupe_key ===
        second.payload._meta.dedupe_key,
      "Equivalent metrics produced different dedupe keys",
    );
  },
);

Deno.test(
  "allows a new cycle after metrics change",
  () => {
    const firstDecision = decision("improve_content");
    const secondDecision = {
      ...firstDecision,
      metrics: {
        ...firstDecision.metrics,
        clicks: firstDecision.metrics.clicks + 1,
      },
    };
    const first = buildRepeatJob(source, firstDecision);
    const second = buildRepeatJob(source, secondDecision);

    assert(first && second, "Expected repeat jobs");
    assert(
      first.payload._meta.dedupe_key !==
        second.payload._meta.dedupe_key,
      "Changed metrics reused the previous dedupe key",
    );
  },
);

Deno.test(
  "preserves the optimization evidence",
  () => {
    const original = decision("scale_content");
    const job = buildRepeatJob(source, original);

    assert(job, "Expected a repeat job");
    assert(
      job.payload.source_job_id === source.job_id,
      "Source job id mismatch",
    );
    assert(
      job.payload.optimization.reason === original.reason,
      "Optimization reason mismatch",
    );
    assert(
      job.payload.optimization.metrics.revenue === 25,
      "Optimization metrics mismatch",
    );
  },
);

Deno.test(
  "requires a repeat source identity",
  () => {
    let message = "";

    try {
      buildRepeatJob(
        { ...source, job_id: " " },
        decision("improve_content"),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assert(
      message === "Repeat source job id is required",
      "Missing source job id was not rejected",
    );
  },
);
