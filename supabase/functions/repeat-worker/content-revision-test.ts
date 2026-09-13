import type {
  RepeatExecutionPlan,
} from "./plan.ts";
import {
  buildContentRevisionJob,
} from "./content-revision.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function revisionPlan(): RepeatExecutionPlan {
  return {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000006000",
    request_id:
      "00000000-0000-4000-8000-000000006001",
    source_content_id:
      "00000000-0000-4000-8000-000000006002",
    referral_link_id:
      "00000000-0000-4000-8000-000000006003",
    action: "improve_content",
    target: {
      agent: "content",
      task_type: "content_revision",
    },
    reason: "Qualified traffic has no conversions",
    priority: 80,
    metrics: {
      clicks: 20,
      conversions: 0,
      revenue: 0,
      conversion_rate: 0,
    },
    dedupe_key:
      "repeat:improve_content:diagnostic:plan",
  };
}

Deno.test(
  "builds an isolated content revision job",
  () => {
    const plan = revisionPlan();
    const job = buildContentRevisionJob(plan);

    assert(job.agent === "content", "Agent mismatch");
    assert(
      job.task_type === "content_revision",
      "Task type mismatch",
    );
    assert(
      job.payload.source_content_id ===
        plan.source_content_id,
      "Source content id mismatch",
    );
  },
);

Deno.test(
  "builds a stable revision dedupe key",
  () => {
    const plan = revisionPlan();
    const first = buildContentRevisionJob(plan);
    const second = buildContentRevisionJob(plan);

    assert(
      first.payload._meta.dedupe_key ===
        second.payload._meta.dedupe_key,
      "Revision dedupe key changed",
    );
    assert(
      first.payload._meta.dedupe_key ===
        `${plan.dedupe_key}:content_revision`,
      "Revision dedupe key mismatch",
    );
  },
);

Deno.test(
  "preserves optimization evidence",
  () => {
    const plan = revisionPlan();
    const job = buildContentRevisionJob(plan);

    assert(
      job.payload.revision.reason === plan.reason,
      "Revision reason mismatch",
    );
    assert(
      job.payload.revision.metrics.clicks === 20,
      "Revision metrics mismatch",
    );
  },
);

Deno.test(
  "forbids mutation of the published source",
  () => {
    const job = buildContentRevisionJob(
      revisionPlan(),
    );

    assert(
      job.payload.safeguards.preserve_source_content,
      "Source preservation is not required",
    );
    assert(
      !job.payload.safeguards.allow_published_overwrite,
      "Published overwrite was allowed",
    );
    assert(
      !job.payload.safeguards.reuse_source_slug,
      "Source slug reuse was allowed",
    );
  },
);

Deno.test(
  "rejects a topic expansion plan",
  () => {
    const plan = revisionPlan();
    plan.action = "scale_content";
    plan.target = {
      agent: "topic_scout",
      task_type: "topic_expansion",
    };

    let message = "";
    try {
      buildContentRevisionJob(plan);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Content revision requires improve_content",
      "Topic expansion plan was accepted",
    );
  },
);

Deno.test(
  "rejects a foreign target agent",
  () => {
    const plan = revisionPlan();
    plan.target.agent = "topic_scout";

    let message = "";
    try {
      buildContentRevisionJob(plan);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Content revision plan target is invalid",
      "Foreign target agent was accepted",
    );
  },
);

Deno.test(
  "requires the source content id",
  () => {
    const plan = revisionPlan();
    plan.source_content_id = "";

    let message = "";
    try {
      buildContentRevisionJob(plan);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Content revision source content id is required",
      "Missing source content id was accepted",
    );
  },
);
