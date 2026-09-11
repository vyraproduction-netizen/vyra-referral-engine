import type {
  RepeatExecutionPlan,
} from "./plan.ts";
import {
  buildTopicExpansionJob,
} from "./topic-expansion.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function expansionPlan(): RepeatExecutionPlan {
  return {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000007000",
    request_id:
      "00000000-0000-4000-8000-000000007001",
    source_content_id:
      "00000000-0000-4000-8000-000000007002",
    referral_link_id:
      "00000000-0000-4000-8000-000000007003",
    action: "scale_content",
    target: {
      agent: "topic_scout",
      task_type: "topic_expansion",
    },
    reason: "Conversion and revenue thresholds were reached",
    priority: 60,
    metrics: {
      clicks: 100,
      conversions: 5,
      revenue: 25,
      conversion_rate: 0.05,
    },
    dedupe_key:
      "repeat:scale_content:diagnostic:plan",
  };
}

Deno.test(
  "builds an isolated topic expansion job",
  () => {
    const plan = expansionPlan();
    const job = buildTopicExpansionJob(plan);

    assert(job.agent === "topic_scout", "Agent mismatch");
    assert(
      job.task_type === "topic_expansion",
      "Task type mismatch",
    );
    assert(job.status === "queued", "Status mismatch");
    assert(job.priority === plan.priority, "Priority mismatch");
  },
);

Deno.test(
  "preserves topic expansion lineage",
  () => {
    const plan = expansionPlan();
    const job = buildTopicExpansionJob(plan);

    assert(
      job.payload.source_repeat_job_id ===
        plan.source_repeat_job_id,
      "Repeat lineage mismatch",
    );
    assert(
      job.payload.source_content_id ===
        plan.source_content_id,
      "Content lineage mismatch",
    );
    assert(
      job.payload.referral_link_id ===
        plan.referral_link_id,
      "Referral lineage mismatch",
    );
  },
);

Deno.test(
  "preserves optimization evidence",
  () => {
    const plan = expansionPlan();
    const job = buildTopicExpansionJob(plan);

    assert(
      job.payload.expansion.reason === plan.reason,
      "Expansion reason mismatch",
    );
    assert(
      job.payload.expansion.metrics.revenue === 25,
      "Expansion revenue mismatch",
    );
    assert(
      job.payload.expansion.metrics.conversion_rate === 0.05,
      "Expansion rate mismatch",
    );
  },
);

Deno.test(
  "builds a stable topic expansion dedupe key",
  () => {
    const plan = expansionPlan();
    const first = buildTopicExpansionJob(plan);
    const second = buildTopicExpansionJob(plan);

    assert(
      first.payload._meta.dedupe_key ===
        second.payload._meta.dedupe_key,
      "Expansion dedupe key changed",
    );
    assert(
      first.payload._meta.dedupe_key ===
        `${plan.dedupe_key}:topic_expansion`,
      "Expansion dedupe key mismatch",
    );
  },
);

Deno.test(
  "protects the source and duplicate boundary",
  () => {
    const job = buildTopicExpansionJob(
      expansionPlan(),
    );

    assert(
      job.payload.safeguards.preserve_source_content,
      "Source preservation is not required",
    );
    assert(
      job.payload.safeguards.require_source_topic,
      "Source topic resolution is not required",
    );
    assert(
      !job.payload.safeguards.allow_duplicate_topics,
      "Duplicate topics were allowed",
    );
  },
);

Deno.test(
  "rejects a content revision plan",
  () => {
    const plan = expansionPlan();
    plan.action = "improve_content";
    plan.target = {
      agent: "content",
      task_type: "content_revision",
    };

    let message = "";
    try {
      buildTopicExpansionJob(plan);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Topic expansion requires scale_content",
      "Content revision plan was accepted",
    );
  },
);

Deno.test(
  "rejects a foreign target agent",
  () => {
    const plan = expansionPlan();
    plan.target.agent = "content";

    let message = "";
    try {
      buildTopicExpansionJob(plan);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Topic expansion plan target is invalid",
      "Foreign target agent was accepted",
    );
  },
);

Deno.test(
  "requires the source content id",
  () => {
    const plan = expansionPlan();
    plan.source_content_id = " ";

    let message = "";
    try {
      buildTopicExpansionJob(plan);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Topic expansion source content id is required",
      "Missing source content id was accepted",
    );
  },
);
