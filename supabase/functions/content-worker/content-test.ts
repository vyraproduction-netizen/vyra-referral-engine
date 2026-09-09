import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertContentJob,
  createContentSlug,
  runContent,
} from "./content.ts";
import {
  createContentProvider,
  resolveContentProviderName,
} from "./content-provider.ts";

function createJob(): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000000912",
    agent: "content",
    task_type: "content_draft",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000912",
      language: "ru",
      region: "EU",
      topic_seed: "image enhancement",
      source_job_id:
        "00000000-0000-4000-8000-000000000911",
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
          "00000000-0000-4000-8000-000000000911:content_draft:https://example.local/tools/image-enhancer",
      },
    },
  };
}

Deno.test(
  "content provider defaults to disabled",
  () => {
    if (resolveContentProviderName(undefined) !== "disabled") {
      throw new Error("Missing provider must be disabled");
    }
  },
);

Deno.test(
  "createContentSlug is deterministic",
  () => {
    const first = createContentSlug(
      "https://example.local/tools/image-enhancer",
      "ru",
    );
    const second = createContentSlug(
      "https://example.local/tools/image-enhancer",
      "ru",
    );

    if (
      first !== "example-local-tools-image-enhancer-ru" ||
      first !== second
    ) {
      throw new Error(`Unexpected slug: ${first}`);
    }
  },
);

Deno.test(
  "content worker creates a deterministic draft",
  async () => {
    const job = createJob();
    assertContentJob(job);

    const draft = await runContent(
      job,
      createContentProvider("mock"),
    );

    if (draft.status !== "draft") {
      throw new Error("Expected draft status");
    }

    if (draft.language !== "ru") {
      throw new Error("Content language was not preserved");
    }

    if (!draft.body.includes("Example Enhancer")) {
      throw new Error("Generated body lost the candidate title");
    }

    if (
      draft.evidence.source_job_id !==
        job.payload.source_job_id
    ) {
      throw new Error("Source job evidence was not preserved");
    }
  },
);

Deno.test(
  "content worker persists provider usage in draft evidence",
  async () => {
    const job = createJob();
    assertContentJob(job);

    const draft = await runContent(job, async () => ({
      title: "Usage test",
      body: "Usage test body",
      excerpt: "Usage test excerpt",
      meta_title: "Usage test title",
      meta_description: "Usage test description",
      usage: {
        input_tokens: 123,
        output_tokens: 45,
        total_tokens: 168,
        cached_input_tokens: 10,
      },
    }));

    const usage = draft.evidence.generation_usage as {
      input_tokens?: unknown;
      output_tokens?: unknown;
      total_tokens?: unknown;
      cached_input_tokens?: unknown;
    } | undefined;

    if (
      usage?.input_tokens !== 123 ||
      usage.output_tokens !== 45 ||
      usage.total_tokens !== 168 ||
      usage.cached_input_tokens !== 10
    ) {
      throw new Error("Provider usage was not persisted in draft evidence");
    }
  },
);

Deno.test(
  "content contract rejects a wrong agent",
  () => {
    const job = createJob();
    job.agent = "research";

    let rejected = false;

    try {
      assertContentJob(job);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error("Wrong content agent was accepted");
    }
  },
);
