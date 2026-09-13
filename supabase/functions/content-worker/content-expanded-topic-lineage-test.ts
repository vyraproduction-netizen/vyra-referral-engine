import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  resolveContentExpandedTopicLineage,
} from "./content-expanded-topic-lineage.ts";
import {
  assertContentJob,
  type ContentJob,
} from "./content.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const topicExpansion = {
  lineage: {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000008100",
    source_content_id:
      "00000000-0000-4000-8000-000000008101",
    referral_link_id:
      "00000000-0000-4000-8000-000000008102",
    execution_dedupe_key:
      "runtime:expanded-topic:8100:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function createJob(value?: unknown): ContentJob {
  const job: VyraJob = {
    id: "00000000-0000-4000-8000-000000008103",
    agent: "content",
    task_type: "content_draft",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000008104",
      language: "en",
      region: "EU",
      topic_seed: "expanded AI tools",
      source_job_id: "00000000-0000-4000-8000-000000008105",
      candidate: {
        title: "Expanded AI Tool",
        url: "https://example.local/expanded-ai-tool",
      },
      recommendation: "content_candidate",
      research: {
        query: "expanded AI tools",
        answer: "Expansion evidence",
        results_count: 1,
        sources: [],
      },
      evidence: {
        evidence_source: "mock",
        opportunity_score: 0.82,
        commercial_intent: 0.8,
        content_potential: 0.84,
        referral_potential: 0.81,
        relevance: 0.83,
      },
      ...(value === undefined ? {} : { topic_expansion: value }),
      _meta: {
        dedupe_key: "runtime:expanded-topic:8103:content_draft",
      },
    },
  };

  assertContentJob(job);
  return job;
}

Deno.test("resolves expanded-topic lineage from a Content job", () => {
  const result = resolveContentExpandedTopicLineage(
    createJob(topicExpansion),
  );

  assert(result, "Expected expanded-topic lineage");
  assert(
    result.lineage.source_repeat_job_id ===
      topicExpansion.lineage.source_repeat_job_id,
    "Source Repeat job id changed",
  );
  assert(
    result.lineage.source_content_id ===
      topicExpansion.lineage.source_content_id,
    "Source content id changed",
  );
  assert(
    result.lineage.referral_link_id ===
      topicExpansion.lineage.referral_link_id,
    "Referral link id changed",
  );
  assert(
    result.lineage.execution_dedupe_key ===
      topicExpansion.lineage.execution_dedupe_key,
    "Execution dedupe key changed",
  );
});

Deno.test("keeps ordinary Content jobs compatible", () => {
  assert(
    resolveContentExpandedTopicLineage(createJob()) === null,
    "Ordinary Content job received expansion lineage",
  );
});

Deno.test("returns an isolated Content lineage value", () => {
  const result = resolveContentExpandedTopicLineage(
    createJob(topicExpansion),
  );

  assert(result, "Expected expanded-topic lineage");
  assert(
    result.lineage !== topicExpansion.lineage,
    "Lineage object was not copied",
  );
  assert(
    result.safeguards !== topicExpansion.safeguards,
    "Safeguards object was not copied",
  );
});

for (
  const field of [
    "source_repeat_job_id",
    "source_content_id",
    "referral_link_id",
    "execution_dedupe_key",
  ] as const
) {
  Deno.test(`rejects a missing Content ${field}`, () => {
    let rejected = false;

    try {
      resolveContentExpandedTopicLineage(
        createJob({
          ...topicExpansion,
          lineage: {
            ...topicExpansion.lineage,
            [field]: "",
          },
        }),
      );
    } catch {
      rejected = true;
    }

    assert(rejected, `Missing ${field} was accepted`);
  });
}

Deno.test("rejects incomplete Content expansion metadata", () => {
  let rejected = false;

  try {
    resolveContentExpandedTopicLineage(
      createJob({ lineage: topicExpansion.lineage }),
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Incomplete expansion metadata was accepted");
});

Deno.test("rejects weakened Content expansion safeguards", () => {
  let rejected = false;

  try {
    resolveContentExpandedTopicLineage(
      createJob({
        ...topicExpansion,
        safeguards: {
          ...topicExpansion.safeguards,
          preserve_source_content: false,
        },
      }),
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Weakened expansion safeguards were accepted");
});
