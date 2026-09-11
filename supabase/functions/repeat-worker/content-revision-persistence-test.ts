import type {
  CreatedVyraJob,
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import {
  enqueueContentRevisionJob,
} from "./content-revision-persistence.ts";
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

function revisionPlan(): RepeatExecutionPlan {
  return {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000006100",
    request_id:
      "00000000-0000-4000-8000-000000006101",
    source_content_id:
      "00000000-0000-4000-8000-000000006102",
    referral_link_id:
      "00000000-0000-4000-8000-000000006103",
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
      "repeat:improve_content:persistence:plan",
  };
}

Deno.test(
  "creates one content revision job",
  async () => {
    let inserted: VyraJobInput[] = [];

    const result = await enqueueContentRevisionJob(
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
              "00000000-0000-4000-8000-000000006104",
            dedupeKey: metadata.dedupe_key,
          };
          return Promise.resolve([created]);
        },
      },
      revisionPlan(),
    );

    assert(result.created, "Revision was not created");
    assert(!result.reused, "New revision was reused");
    assert(inserted.length === 1, "Unexpected insert count");
    assert(
      inserted[0].task_type === "content_revision",
      "Unexpected inserted task type",
    );
  },
);

Deno.test(
  "reuses an existing content revision dedupe key",
  async () => {
    let createCalls = 0;

    const result = await enqueueContentRevisionJob(
      {
        existsByDedupeKey: () =>
          Promise.resolve(true),
        createMany: () => {
          createCalls += 1;
          return Promise.resolve([]);
        },
      },
      revisionPlan(),
    );

    assert(!result.created, "Duplicate revision was created");
    assert(result.reused, "Existing revision was not reused");
    assert(result.job === null, "Reused job must be null");
    assert(createCalls === 0, "Duplicate insert was attempted");
  },
);

Deno.test(
  "preserves the stable revision dedupe key",
  async () => {
    let checkedDedupeKey = "";

    const result = await enqueueContentRevisionJob(
      {
        existsByDedupeKey: (dedupeKey) => {
          checkedDedupeKey = dedupeKey;
          return Promise.resolve(true);
        },
        createMany: () => Promise.resolve([]),
      },
      revisionPlan(),
    );

    assert(
      checkedDedupeKey === result.dedupe_key,
      "Checked dedupe key changed",
    );
    assert(
      result.dedupe_key.endsWith(
        ":plan:content_revision",
      ),
      "Revision dedupe suffix mismatch",
    );
  },
);

Deno.test(
  "rejects topic expansion before store access",
  async () => {
    const plan = revisionPlan();
    plan.action = "scale_content";
    plan.target = {
      agent: "topic_scout",
      task_type: "topic_expansion",
    };
    let storeCalls = 0;
    let message = "";

    try {
      await enqueueContentRevisionJob(
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
      message ===
        "Content revision requires improve_content",
      "Topic expansion plan was not rejected",
    );
    assert(storeCalls === 0, "Store was accessed");
  },
);

Deno.test(
  "rejects an empty create result",
  async () => {
    let message = "";

    try {
      await enqueueContentRevisionJob(
        {
          existsByDedupeKey: () =>
            Promise.resolve(false),
          createMany: () => Promise.resolve([]),
        },
        revisionPlan(),
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Content revision job was not created",
      "Empty create result was accepted",
    );
  },
);
