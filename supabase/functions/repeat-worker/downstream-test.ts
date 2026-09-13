import type {
  ContentRevisionEnqueueResult,
} from "./content-revision-persistence.ts";
import {
  routeRepeatDownstream,
} from "./downstream.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";
import type {
  TopicExpansionEnqueueResult,
} from "./topic-expansion-persistence.ts";

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

const revisionResult: ContentRevisionEnqueueResult = {
  created: true,
  reused: false,
  dedupe_key:
    "repeat:improve_content:downstream:plan:content_revision",
  job: {
    id: "00000000-0000-4000-8000-000000006204",
    dedupeKey:
      "repeat:improve_content:downstream:plan:content_revision",
  },
};

const expansionResult: TopicExpansionEnqueueResult = {
  created: true,
  reused: false,
  dedupe_key:
    "repeat:scale_content:downstream:plan:topic_expansion",
  job: {
    id: "00000000-0000-4000-8000-000000006205",
    dedupeKey:
      "repeat:scale_content:downstream:plan:topic_expansion",
  },
};

Deno.test(
  "routes improve_content only to revision persistence",
  async () => {
    let revisionCalls = 0;
    let expansionCalls = 0;

    const result = await routeRepeatDownstream(
      plan("improve_content"),
      () => {
        revisionCalls += 1;
        return Promise.resolve(revisionResult);
      },
      () => {
        expansionCalls += 1;
        return Promise.resolve(expansionResult);
      },
    );

    assert(revisionCalls === 1, "Revision was not called once");
    assert(expansionCalls === 0, "Expansion was called");
    assert(
      result.execution === "content_revision",
      "Revision execution mismatch",
    );
    assert(
      result.content_revision === revisionResult,
      "Revision result mismatch",
    );
    assert(
      result.topic_expansion === null,
      "Revision returned an expansion result",
    );
  },
);

Deno.test(
  "routes scale_content only to expansion persistence",
  async () => {
    let revisionCalls = 0;
    let expansionCalls = 0;

    const result = await routeRepeatDownstream(
      plan("scale_content"),
      () => {
        revisionCalls += 1;
        return Promise.resolve(revisionResult);
      },
      () => {
        expansionCalls += 1;
        return Promise.resolve(expansionResult);
      },
    );

    assert(revisionCalls === 0, "Revision was called");
    assert(expansionCalls === 1, "Expansion was not called once");
    assert(
      result.execution === "topic_expansion",
      "Expansion execution mismatch",
    );
    assert(
      result.content_revision === null,
      "Expansion returned a revision result",
    );
    assert(
      result.topic_expansion === expansionResult,
      "Expansion result mismatch",
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
      () => Promise.resolve(expansionResult),
    );

    assert(
      result.execution === "content_revision" &&
        result.content_revision.reused,
      "Reused revision result was not preserved",
    );
  },
);

Deno.test(
  "preserves a reused expansion result",
  async () => {
    const reused: TopicExpansionEnqueueResult = {
      created: false,
      reused: true,
      dedupe_key:
        "repeat:scale_content:downstream:plan:topic_expansion",
      job: null,
    };

    const result = await routeRepeatDownstream(
      plan("scale_content"),
      () => Promise.resolve(revisionResult),
      () => Promise.resolve(reused),
    );

    assert(
      result.execution === "topic_expansion" &&
        result.topic_expansion.reused,
      "Reused expansion result was not preserved",
    );
  },
);
