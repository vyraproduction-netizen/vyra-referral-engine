import {
  attachTopicExpansionLineage,
  attachTopicExpansionLineageToJobs,
} from "./expanded-topic-research.ts";
import type {
  ResearchJob,
} from "./research-job.ts";
import type {
  TopicExpansionExecution,
} from "./topic-expansion.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const job: ResearchJob = {
  agent: "research",
  task_type: "topic_research",
  status: "queued",
  priority: 82,
  max_attempts: 3,
  payload: {
    request_id: "00000000-0000-4000-8000-000000007100",
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

const expansion: TopicExpansionExecution = {
  request_id: job.payload.request_id,
  language: job.payload.language,
  region: job.payload.region,
  topic_seed: job.payload.topic_seed,
  constraints: {
    max_topics: 10,
    min_score: 0.7,
  },
  lineage: {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000007101",
    source_content_id:
      "00000000-0000-4000-8000-000000007102",
    referral_link_id:
      "00000000-0000-4000-8000-000000007103",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
  _meta: {
    dedupe_key:
      "runtime:topic-expansion:7100:execution",
  },
};

Deno.test(
  "attaches Topic Expansion lineage to a Research job",
  () => {
    const result = attachTopicExpansionLineage(
      job,
      expansion,
    );

    assert(
      result.payload.topic_expansion.lineage
          .source_repeat_job_id ===
        expansion.lineage.source_repeat_job_id,
      "Source Repeat job lineage was not preserved",
    );
    assert(
      result.payload.topic_expansion.lineage
          .source_content_id ===
        expansion.lineage.source_content_id,
      "Source content lineage was not preserved",
    );
    assert(
      result.payload.topic_expansion.lineage
          .referral_link_id ===
        expansion.lineage.referral_link_id,
      "Referral link lineage was not preserved",
    );
    assert(
      result.payload.topic_expansion.lineage
          .execution_dedupe_key ===
        expansion._meta.dedupe_key,
      "Execution dedupe key was not preserved",
    );
  },
);

Deno.test(
  "preserves the original Research candidate",
  () => {
    const result = attachTopicExpansionLineage(
      job,
      expansion,
    );

    assert(
      result.payload.candidate.url ===
        job.payload.candidate.url,
      "Research candidate changed",
    );
    assert(
      result.payload.recommended_action ===
        job.payload.recommended_action,
      "Research recommendation changed",
    );
  },
);

Deno.test(
  "does not add lineage to ordinary Research jobs",
  () => {
    const result = attachTopicExpansionLineageToJobs(
      [job],
      null,
    );

    assert(result[0] === job, "Ordinary Research job changed");
    assert(
      !("topic_expansion" in result[0].payload),
      "Ordinary Research job received expansion lineage",
    );
  },
);

Deno.test(
  "attaches lineage to every expanded-topic Research job",
  () => {
    const secondJob: ResearchJob = {
      ...job,
      payload: {
        ...job.payload,
        candidate: {
          ...job.payload.candidate,
          title: "AI Photo Restoration",
          url: "https://example.local/restore",
        },
      },
    };

    const result = attachTopicExpansionLineageToJobs(
      [job, secondJob],
      expansion,
    );

    assert(result.length === 2, "Research job count changed");
    assert(
      result.every((item) =>
        "topic_expansion" in item.payload
      ),
      "Expansion lineage was not attached to every job",
    );
  },
);

for (
  const [field, changedExpansion] of [
    [
      "request id",
      { ...expansion, request_id: "foreign-request" },
    ],
    [
      "language",
      { ...expansion, language: "de" },
    ],
    [
      "region",
      { ...expansion, region: "US" },
    ],
    [
      "topic seed",
      { ...expansion, topic_seed: "video enhancement" },
    ],
  ] as const
) {
  Deno.test(
    `rejects a mismatched ${field}`,
    () => {
      let rejected = false;

      try {
        attachTopicExpansionLineage(
          job,
          changedExpansion,
        );
      } catch {
        rejected = true;
      }

      assert(rejected, `Mismatched ${field} was accepted`);
    },
  );
}

Deno.test(
  "rejects weakened Topic Expansion safeguards",
  () => {
    let rejected = false;

    try {
      attachTopicExpansionLineage(job, {
        ...expansion,
        safeguards: {
          ...expansion.safeguards,
          allow_duplicate_topics: true as false,
        },
      });
    } catch {
      rejected = true;
    }

    assert(rejected, "Weakened safeguards were accepted");
  },
);
