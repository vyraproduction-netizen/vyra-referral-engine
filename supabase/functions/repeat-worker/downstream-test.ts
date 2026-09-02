import type {
  ContentRevisionEnqueueResult,
} from "./content-revision-persistence.ts";
import {
  routeRepeatDownstream,
} from "./downstream.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function plan(
  action: "improve_content" | "scale_content",
): RepeatExecutionPlan {
  const improve = action === "improve_content";

  return {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000006200",
    request_id:
      "00000000-0000-4000-8000-000000006201",
    source_content_id:
      "00000000-0000-4000-8000-000000006202",
    referral_link_id:
      "00000000-0000-4000-8000-000000006203",
    action,
    target: improve
      ? {
        agent: "content",
        task_type: "content_revision",
      }
      : {
        agent: "topic_scout",
        task_type: "topic_expansion",
      },
    reason: `Diagnostic ${action}`,
    priority: improve ? 80 : 60,
    metrics: {
      clicks: improve ? 20 : 100,
      conversions: improve ? 0 : 5,
      revenue: improve ? 0 : 25,
      conversion_rate: improve ? 0 : 0.05,
    },
    dedupe_key: `repeat:${action}:downstream:plan`,
  };
}

Deno.test(
  "routes improve_content to revision persistence",
  async () => {
    let calls = 0;
    const expected: ContentRevisionEnqueueResult = {
      created: true,
      reused: false,
      dedupe_key:
        "repeat:improve_content:downstream:plan:content_revision",
      job: {
        id:
          "00000000-0000-4000-8000-000000006204",
        dedupeKey:
          "repeat:improve_content:downstream:plan:content_revision",
      },
    };

    const result = await routeRepeatDownstream(
      plan("improve_content"),
      () => {
        calls += 1;
        return Promise.resolve(expected);
      },
    );

    assert(calls === 1, "Revision persistence was not called");
    assert(
      result.execution === "content_revision",
      "Revision execution mismatch",
    );
    assert(
      result.content_revision === expected,
      "Revision result mismatch",
    );
  },
);

Deno.test(
  "keeps scale_content as planned only",
  async () => {
    let calls = 0;

    const result = await routeRepeatDownstream(
      plan("scale_content"),
      () => {
        calls += 1;
        throw new Error("Unexpected persistence call");
      },
    );

    assert(calls === 0, "Scale plan accessed persistence");
    assert(
      result.execution === "planned_only",
      "Scale execution must remain planned only",
    );
    assert(
      result.content_revision === null,
      "Scale plan created a revision result",
    );
  },
);

Deno.test(
  "preserves a reused revision result",
  async () => {
    const reused: ContentRevisionEnqueueResult = {
      created: false,
      reused: true,
      dedupe_key:
        "repeat:improve_content:downstream:plan:content_revision",
      job: null,
    };

    const result = await routeRepeatDownstream(
      plan("improve_content"),
      () => Promise.resolve(reused),
    );

    assert(
      result.execution === "content_revision" &&
        result.content_revision.reused,
      "Reused revision result was not preserved",
    );
  },
);
