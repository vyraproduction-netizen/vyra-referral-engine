import {
  buildContentJob,
  enqueueContentJob,
} from "./content-job.ts";
import type {
  ResearchFinding,
  ResearchJob,
} from "./research.ts";

function createSourceJob(): ResearchJob {
  return {
    id: "00000000-0000-4000-8000-000000000910",
    agent: "research",
    task_type: "topic_research",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000910",
      language: "ru",
      region: "EU",
      topic_seed: "image enhancement",
      candidate: {
        title: "Example enhancer",
        url: "https://example.local/enhancer",
        opportunity_score: 0.8,
        commercial_intent: 0.7,
        content_potential: 0.82,
        referral_potential: 0.9,
        relevance: 0.85,
        evidence_source: "mock",
      },
      recommended_action:
        "investigate_referral_program",
    },
  };
}

function createFinding(
  recommendation = "investigate_referral_program",
): ResearchFinding {
  return {
    candidate_url:
      "https://example.local/enhancer",
    candidate_title: "Example enhancer",
    recommendation,
    opportunity_score: 0.8,
    commercial_intent: 0.7,
    content_potential: 0.82,
    referral_potential: 0.9,
    relevance: 0.85,
    evidence_source: "mock",
    research: {
      query: "example enhancer referral program",
      answer: "Example research answer",
      results_count: 1,
      sources: [
        {
          title: "Example source",
          url: "https://example.local/source",
          content: "Example evidence",
          score: 0.9,
        },
      ],
    },
  };
}

Deno.test(
  "buildContentJob creates a stable content contract",
  () => {
    const sourceJob = createSourceJob();
    const contentJob = buildContentJob(
      sourceJob,
      createFinding(),
    );

    if (!contentJob) {
      throw new Error("Expected a content job");
    }

    if (contentJob.agent !== "content") {
      throw new Error("Unexpected content agent");
    }

    if (contentJob.task_type !== "content_draft") {
      throw new Error("Unexpected content task type");
    }

    if (contentJob.priority !== 82) {
      throw new Error(
        `Expected priority 82, received ${contentJob.priority}`,
      );
    }

    if (
      contentJob.payload.source_job_id !==
        sourceJob.id
    ) {
      throw new Error("Source job ID was not preserved");
    }

    const expectedDedupeKey =
      `${sourceJob.id}:content_draft:https://example.local/enhancer`;

    if (
      contentJob.payload._meta.dedupe_key !==
        expectedDedupeKey
    ) {
      throw new Error("Unexpected content dedupe key");
    }
  },
);

Deno.test(
  "buildContentJob skips discarded findings",
  () => {
    const contentJob = buildContentJob(
      createSourceJob(),
      createFinding("discard"),
    );

    if (contentJob !== null) {
      throw new Error(
        "Discarded finding must not create a content job",
      );
    }
  },
);

Deno.test(
  "enqueueContentJob creates one new job",
  async () => {
    let createCalls = 0;

    const created = await enqueueContentJob(
      {
        existsByDedupeKey: async () => false,
        createMany: () => {
          createCalls += 1;

          return Promise.resolve([
            {
              id: "00000000-0000-4000-8000-000000000911",
              dedupeKey:
                "00000000-0000-4000-8000-000000000910:content_draft:https://example.local/enhancer",
            },
          ]);
        },
      },
      createSourceJob(),
      createFinding(),
    );

    if (!created || createCalls !== 1) {
      throw new Error("Expected one created content job");
    }
  },
);

Deno.test(
  "enqueueContentJob skips an existing dedupe key",
  async () => {
    let createCalls = 0;

    const created = await enqueueContentJob(
      {
        existsByDedupeKey: async () => true,
        createMany: () => {
          createCalls += 1;
          return Promise.resolve([]);
        },
      },
      createSourceJob(),
      createFinding(),
    );

    if (created !== null || createCalls !== 0) {
      throw new Error(
        "Existing dedupe key must skip insertion",
      );
    }
  },
);
