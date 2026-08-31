import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  createPublisherProvider,
} from "./publisher-provider.ts";
import {
  assertPublisherJob,
  runPublisher,
} from "./publisher.ts";
import type {
  PublisherContent,
} from "./publisher.ts";

function createJob(): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000000940",
    agent: "publisher",
    task_type: "content_publish",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000941",
      source_qa_job_id:
        "00000000-0000-4000-8000-000000000942",
      source_content_job_id:
        "00000000-0000-4000-8000-000000000943",
      source_research_job_id:
        "00000000-0000-4000-8000-000000000944",
      content_id:
        "00000000-0000-4000-8000-000000000945",
      language: "ru",
      title: "Diagnostic approved content",
      slug: "diagnostic-approved-content",
      qa_score: 1,
      _meta: {
        dedupe_key:
          "00000000-0000-4000-8000-000000000945:content_publish",
      },
    },
  };
}

function createContent(): PublisherContent {
  return {
    id: "00000000-0000-4000-8000-000000000945",
    title: "Diagnostic approved content",
    slug: "diagnostic-approved-content",
    language: "ru",
    status: "approved",
    body: "Diagnostic approved article body.",
    excerpt: "Diagnostic excerpt.",
    meta_title: "Diagnostic approved content",
    meta_description: "Diagnostic description.",
    published_url: null,
  };
}

Deno.test(
  "assertPublisherJob accepts a valid contract",
  () => {
    const job = createJob();
    assertPublisherJob(job);

    if (job.payload.qa_score !== 1) {
      throw new Error("QA score was not preserved");
    }
  },
);

Deno.test(
  "assertPublisherJob rejects a low QA score",
  () => {
    const job = createJob();

    if (!job.payload) {
      throw new Error("Fixture payload is required");
    }

    job.payload.qa_score = 0.79;
    let rejected = false;

    try {
      assertPublisherJob(job);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error("Low QA score was accepted");
    }
  },
);

Deno.test(
  "mock publisher creates a stable local URL",
  async () => {
    const job = createJob();
    assertPublisherJob(job);

    const result = await runPublisher(
      job,
      createContent(),
      createPublisherProvider("mock"),
    );

    if (result.provider !== "mock") {
      throw new Error("Unexpected Publisher provider");
    }

    if (
      result.published_url !==
        "https://example.local/published/diagnostic-approved-content"
    ) {
      throw new Error("Unexpected published URL");
    }
  },
);

Deno.test(
  "publisher rejects non-approved content",
  async () => {
    const job = createJob();
    assertPublisherJob(job);
    let rejected = false;

    try {
      await runPublisher(
        job,
        {
          ...createContent(),
          status: "draft",
        },
        createPublisherProvider("mock"),
      );
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error("Non-approved content was published");
    }
  },
);

Deno.test(
  "publisher provider requires explicit configuration",
  () => {
    let rejected = false;

    try {
      createPublisherProvider(undefined);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Missing Publisher provider was accepted",
      );
    }
  },
);
