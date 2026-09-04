import {
  resolveResearchExpandedTopicLineage,
} from "./research-expanded-topic-lineage.ts";
import type {
  ResearchJob,
} from "./research.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const job: ResearchJob = {
  id: "00000000-0000-4000-8000-000000007300",
  agent: "research",
  task_type: "topic_research",
  status: "queued",
  attempts: 0,
  max_attempts: 3,
  payload: {
    request_id: "00000000-0000-4000-8000-000000007301",
    language: "en",
    region: "EU",
    topic_seed: "image enhancement",
    candidate: {
      title: "AI Image Upscaling",
      url: "https://example.local/upscale",
      opportunity_score: 0.82,
      commercial_intent: 0.8,
      content_potential: 0.84,
      referral_potential: 0.81,
      relevance: 0.83,
      evidence_source: "mock",
    },
    recommended_action: "investigate_referral_program",
  },
};

const topicExpansion = {
  lineage: {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000007302",
    source_content_id:
      "00000000-0000-4000-8000-000000007303",
    referral_link_id:
      "00000000-0000-4000-8000-000000007304",
    execution_dedupe_key:
      "runtime:topic-expansion:7300:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function withTopicExpansion(value: unknown): ResearchJob {
  return {
    ...job,
    payload: {
      ...job.payload,
      topic_expansion: value,
    } as ResearchJob["payload"],
  };
}

Deno.test(
  "resolves expanded-topic lineage from a Research job",
  () => {
    const result = resolveResearchExpandedTopicLineage(
      withTopicExpansion(topicExpansion),
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
  },
);

Deno.test(
  "keeps ordinary Research jobs compatible",
  () => {
    assert(
      resolveResearchExpandedTopicLineage(job) === null,
      "Ordinary Research job received expansion lineage",
    );
  },
);

Deno.test(
  "returns an isolated lineage value",
  () => {
    const result = resolveResearchExpandedTopicLineage(
      withTopicExpansion(topicExpansion),
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
  },
);

for (
  const field of [
    "source_repeat_job_id",
    "source_content_id",
    "referral_link_id",
    "execution_dedupe_key",
  ] as const
) {
  Deno.test(
    `rejects a missing ${field}`,
    () => {
      let rejected = false;

      try {
        resolveResearchExpandedTopicLineage(
          withTopicExpansion({
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
    },
  );
}

Deno.test(
  "rejects incomplete expansion metadata",
  () => {
    let rejected = false;

    try {
      resolveResearchExpandedTopicLineage(
        withTopicExpansion({ lineage: topicExpansion.lineage }),
      );
    } catch {
      rejected = true;
    }

    assert(rejected, "Incomplete expansion metadata was accepted");
  },
);

Deno.test(
  "rejects weakened expansion safeguards",
  () => {
    let rejected = false;

    try {
      resolveResearchExpandedTopicLineage(
        withTopicExpansion({
          ...topicExpansion,
          safeguards: {
            ...topicExpansion.safeguards,
            allow_duplicate_topics: true,
          },
        }),
      );
    } catch {
      rejected = true;
    }

    assert(rejected, "Weakened expansion safeguards were accepted");
  },
);
