import {
  buildContentJob,
} from "./content-job.ts";
import {
  resolveResearchExpandedTopicLineage,
} from "./research-expanded-topic-lineage.ts";
import type {
  ResearchFinding,
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

const sourceJob: ResearchJob = {
  id: "00000000-0000-4000-8000-000000007400",
  agent: "research",
  task_type: "topic_research",
  status: "running",
  attempts: 1,
  max_attempts: 3,
  payload: {
    request_id: "00000000-0000-4000-8000-000000007401",
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
    recommended_action: "content_candidate",
  },
};

const finding: ResearchFinding = {
  candidate_url: sourceJob.payload.candidate.url,
  candidate_title: sourceJob.payload.candidate.title,
  recommendation: sourceJob.payload.recommended_action,
  opportunity_score: 0.82,
  commercial_intent: 0.8,
  content_potential: 0.84,
  referral_potential: 0.81,
  relevance: 0.83,
  evidence_source: "mock",
  research: {
    query: "AI Image Upscaling referral program",
    answer: "Mock answer",
    results_count: 1,
    sources: [],
  },
};

const topicExpansion = {
  lineage: {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000007402",
    source_content_id:
      "00000000-0000-4000-8000-000000007403",
    referral_link_id:
      "00000000-0000-4000-8000-000000007404",
    execution_dedupe_key:
      "runtime:topic-expansion:7400:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function withExpansion(value: unknown): ResearchJob {
  return {
    ...sourceJob,
    payload: {
      ...sourceJob.payload,
      topic_expansion: value,
    } as ResearchJob["payload"],
  };
}

Deno.test(
  "routes validated Topic Expansion lineage into a Content job",
  () => {
    const expandedJob = withExpansion(topicExpansion);
    const lineage = resolveResearchExpandedTopicLineage(
      expandedJob,
    );
    const contentJob = buildContentJob(
      expandedJob,
      finding,
      lineage,
    );

    assert(contentJob, "Expected a Content job");
    assert(
      contentJob.payload.topic_expansion?.lineage
          .source_repeat_job_id ===
        topicExpansion.lineage.source_repeat_job_id,
      "Source Repeat lineage was not routed",
    );
    assert(
      contentJob.payload.topic_expansion?.lineage
          .source_content_id ===
        topicExpansion.lineage.source_content_id,
      "Source content lineage was not routed",
    );
    assert(
      contentJob.payload.topic_expansion?.lineage
          .referral_link_id ===
        topicExpansion.lineage.referral_link_id,
      "Referral link lineage was not routed",
    );
  },
);

Deno.test(
  "keeps an ordinary Content job free of expansion metadata",
  () => {
    const contentJob = buildContentJob(
      sourceJob,
      finding,
      resolveResearchExpandedTopicLineage(sourceJob),
    );

    assert(contentJob, "Expected a Content job");
    assert(
      contentJob.payload.topic_expansion === undefined,
      "Ordinary Content job received expansion metadata",
    );
  },
);

Deno.test(
  "rejects invalid lineage before a Content job is built",
  () => {
    let rejected = false;

    try {
      const invalidJob = withExpansion({
        ...topicExpansion,
        safeguards: {
          ...topicExpansion.safeguards,
          preserve_source_content: false,
        },
      });
      const lineage = resolveResearchExpandedTopicLineage(
        invalidJob,
      );

      buildContentJob(invalidJob, finding, lineage);
    } catch {
      rejected = true;
    }

    assert(rejected, "Invalid lineage was accepted");
  },
);

Deno.test(
  "copies lineage into the Content payload",
  () => {
    const expandedJob = withExpansion(topicExpansion);
    const lineage = resolveResearchExpandedTopicLineage(
      expandedJob,
    );
    const contentJob = buildContentJob(
      expandedJob,
      finding,
      lineage,
    );

    assert(contentJob, "Expected a Content job");
    assert(lineage, "Expected expansion lineage");
    assert(
      contentJob.payload.topic_expansion !== lineage,
      "Content job reused the lineage container",
    );
    assert(
      contentJob.payload.topic_expansion?.lineage !==
        lineage.lineage,
      "Content job reused the lineage object",
    );
  },
);
