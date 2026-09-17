import {
  prepareJobInsert,
} from "./db-writer.ts";
import {
  attachTopicExpansionLineageToJobs,
} from "./expanded-topic-research.ts";
import {
  prepareResearchJobs,
} from "./job-writer.ts";
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

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

const job: ResearchJob = {
  agent: "research",
  task_type: "topic_research",
  status: "queued",
  priority: 82,
  max_attempts: 3,
  payload: {
    request_id: "00000000-0000-4000-8000-000000007200",
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
      "00000000-0000-4000-8000-000000007201",
    source_content_id:
      "00000000-0000-4000-8000-000000007202",
    referral_link_id:
      "00000000-0000-4000-8000-000000007203",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
  _meta: {
    dedupe_key:
      "runtime:topic-expansion:7200:execution",
  },
};

function prepareInsert(
  sourceJob: ResearchJob,
  sourceExpansion: TopicExpansionExecution | null,
) {
  const jobs = attachTopicExpansionLineageToJobs(
    [sourceJob],
    sourceExpansion,
  );
  const prepared = prepareResearchJobs(jobs);

  assert(prepared.length === 1, "Research job was not prepared");

  return prepareJobInsert(
    prepared[0].job,
    prepared[0].dedupe_key,
  );
}

Deno.test(
  "persists Topic Expansion lineage in a Research insert row",
  () => {
    const row = prepareInsert(job, expansion);
    const payload = row.payload as Record<string, unknown>;
    const topicExpansion = payload.topic_expansion;

    assert(
      isRecord(topicExpansion),
      "Topic Expansion metadata was not persisted",
    );
    assert(
      isRecord(topicExpansion.lineage),
      "Topic Expansion lineage was not persisted",
    );
    assert(
      topicExpansion.lineage.source_content_id ===
        expansion.lineage.source_content_id,
      "Source content lineage changed",
    );
    assert(
      topicExpansion.lineage.referral_link_id ===
        expansion.lineage.referral_link_id,
      "Referral link lineage changed",
    );
    assert(
      isRecord(payload._meta) &&
        typeof payload._meta.dedupe_key === "string",
      "Research dedupe key was not persisted",
    );
  },
);

Deno.test(
  "keeps ordinary Research insert rows unchanged",
  () => {
    const row = prepareInsert(job, null);
    const payload = row.payload as Record<string, unknown>;

    assert(
      !("topic_expansion" in payload),
      "Ordinary Research row received Topic Expansion metadata",
    );
  },
);
