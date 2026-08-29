import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertContentJob,
  runContent,
} from "./content.ts";
import {
  createContentProvider,
} from "./content-provider.ts";
import {
  buildQaJob,
  enqueueQaJob,
} from "./qa-job.ts";

function createContentJob(): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000000913",
    agent: "content",
    task_type: "content_draft",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000913",
      language: "ru",
      region: "EU",
      topic_seed: "image enhancement",
      source_job_id:
        "00000000-0000-4000-8000-000000000912",
      candidate: {
        title: "Example Enhancer",
        url:
          "https://example.local/tools/image-enhancer",
      },
      recommendation:
        "investigate_referral_program",
      research: {
        query: "example enhancer referral program",
        answer: "A referral program may be available.",
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
      evidence: {
        evidence_source: "mock",
        opportunity_score: 0.8,
        commercial_intent: 0.7,
        content_potential: 0.82,
        referral_potential: 0.9,
        relevance: 0.85,
      },
      _meta: {
        dedupe_key:
          "00000000-0000-4000-8000-000000000912:content_draft:https://example.local/tools/image-enhancer",
      },
    },
  };
}

async function createFixture() {
  const sourceJob = createContentJob();
  assertContentJob(sourceJob);

  const draft = await runContent(
    sourceJob,
    createContentProvider("mock"),
  );

  return {
    sourceJob,
    draft,
    saved: {
      id: "00000000-0000-4000-8000-000000000914",
      slug: draft.slug,
      status: "draft",
    },
  };
}

Deno.test(
  "buildQaJob creates a stable QA contract",
  async () => {
    const fixture = await createFixture();
    const qaJob = buildQaJob(
      fixture.sourceJob,
      fixture.draft,
      fixture.saved,
    );

    if (qaJob.agent !== "qa") {
      throw new Error("Unexpected QA agent");
    }

    if (qaJob.task_type !== "content_qa") {
      throw new Error("Unexpected QA task type");
    }

    if (
      qaJob.payload.content_id !==
        fixture.saved.id
    ) {
      throw new Error("Content id was not preserved");
    }

    if (
      qaJob.payload._meta.dedupe_key !==
        `${fixture.saved.id}:content_qa`
    ) {
      throw new Error("Unexpected QA dedupe key");
    }
  },
);

Deno.test(
  "buildQaJob rejects non-draft content",
  async () => {
    const fixture = await createFixture();
    let rejected = false;

    try {
      buildQaJob(
        fixture.sourceJob,
        fixture.draft,
        {
          ...fixture.saved,
          status: "approved",
        },
      );
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error("Non-draft content was accepted");
    }
  },
);

Deno.test(
  "enqueueQaJob skips an existing dedupe key",
  async () => {
    const fixture = await createFixture();
    let createCalls = 0;

    const created = await enqueueQaJob(
      {
        existsByDedupeKey: async () => true,
        createMany: () => {
          createCalls += 1;
          return Promise.resolve([]);
        },
      },
      fixture.sourceJob,
      fixture.draft,
      fixture.saved,
    );

    if (created !== null || createCalls !== 0) {
      throw new Error(
        "Existing QA dedupe key must skip insertion",
      );
    }
  },
);
