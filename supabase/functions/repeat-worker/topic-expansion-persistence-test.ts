import type {
  CreatedVyraJob,
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";
import {
  enqueueTopicExpansionJob,
} from "./topic-expansion-persistence.ts";

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
      "00000000-0000-4000-8000-000000007100",
    request_id:
      "00000000-0000-4000-8000-000000007101",
    source_content_id:
      "00000000-0000-4000-8000-000000007102",
    referral_link_id:
      "00000000-0000-4000-8000-000000007103",
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
      "repeat:scale_content:persistence:plan",
  };
}

Deno.test(
  "creates one topic expansion job",
  async () => {
    let inserted: VyraJobInput[] = [];

    const result = await enqueueTopicExpansionJob(
      {
        existsByDedupeKey: () =>
          Promise.resolve(false),
        createMany: (jobs) => {
          inserted = jobs;
          const metadata = jobs[0].payload._meta as {
            dedupe_key: string;
          };
          const created: CreatedVyraJob = {
            id:
              "00000000-0000-4000-8000-000000007104",
            dedupeKey: metadata.dedupe_key,
          };
          return Promise.resolve([created]);
        },
      },
      expansionPlan(),
    );

    assert(result.created, "Expansion was not created");
    assert(!result.reused, "New expansion was reused");
    assert(inserted.length === 1, "Unexpected insert count");
    assert(
      inserted[0].agent === "topic_scout",
      "Unexpected inserted agent",
    );
    assert(
      inserted[0].task_type === "topic_expansion",
      "Unexpected inserted task type",
    );
  },
);

Deno.test(
  "reuses an existing topic expansion dedupe key",
  async () => {
    let createCalls = 0;

    const result = await enqueueTopicExpansionJob(
      {
        existsByDedupeKey: () =>
          Promise.resolve(true),
        createMany: () => {
          createCalls += 1;
          return Promise.resolve([]);
        },
      },
      expansionPlan(),
    );

    assert(!result.created, "Duplicate expansion was created");
    assert(result.reused, "Existing expansion was not reused");
    assert(result.job === null, "Reused job must be null");
    assert(createCalls === 0, "Duplicate insert was attempted");
  },
);

Deno.test(
  "checks the stable topic expansion dedupe key",
  async () => {
    let checkedDedupeKey = "";

    const result = await enqueueTopicExpansionJob(
      {
        existsByDedupeKey: (dedupeKey) => {
          checkedDedupeKey = dedupeKey;
          return Promise.resolve(true);
        },
        createMany: () => Promise.resolve([]),
      },
      expansionPlan(),
    );

    assert(
      checkedDedupeKey === result.dedupe_key,
      "Checked dedupe key changed",
    );
    assert(
      result.dedupe_key.endsWith(
        ":plan:topic_expansion",
      ),
      "Expansion dedupe suffix mismatch",
    );
  },
);

Deno.test(
  "rejects content improvement before store access",
  async () => {
    const plan = expansionPlan();
    plan.action = "improve_content";
    plan.target = {
      agent: "content",
      task_type: "content_revision",
    };
    let storeCalls = 0;
    let message = "";

    try {
      await enqueueTopicExpansionJob(
        {
          existsByDedupeKey: () => {
            storeCalls += 1;
            return Promise.resolve(false);
          },
          createMany: () => {
            storeCalls += 1;
            return Promise.resolve([]);
          },
        },
        plan,
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Topic expansion requires scale_content",
      "Content improvement plan was not rejected",
    );
    assert(storeCalls === 0, "Store was accessed");
  },
);

Deno.test(
  "rejects an empty create result",
  async () => {
    let message = "";

    try {
      await enqueueTopicExpansionJob(
        {
          existsByDedupeKey: () =>
            Promise.resolve(false),
          createMany: () => Promise.resolve([]),
        },
        expansionPlan(),
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Topic expansion job was not created",
      "Empty create result was accepted",
    );
  },
);

Deno.test(
  "rejects a changed persisted dedupe key",
  async () => {
    let message = "";

    try {
      await enqueueTopicExpansionJob(
        {
          existsByDedupeKey: () =>
            Promise.resolve(false),
          createMany: () => Promise.resolve([{
            id:
              "00000000-0000-4000-8000-000000007105",
            dedupeKey: "changed:dedupe:key",
          }]),
        },
        expansionPlan(),
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Topic expansion dedupe key was not preserved",
      "Changed persisted dedupe key was accepted",
    );
  },
);
