import {
  buildPublishJob,
  enqueuePublishJob,
} from "./publish-job.ts";
import type {
  QaJob,
  QaResult,
} from "./qa.ts";

function createQaJob(): QaJob {
  return {
    id: "00000000-0000-4000-8000-000000000920",
    agent: "qa",
    task_type: "content_qa",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000921",
      source_content_job_id:
        "00000000-0000-4000-8000-000000000922",
      source_research_job_id:
        "00000000-0000-4000-8000-000000000923",
      content_id:
        "00000000-0000-4000-8000-000000000924",
      language: "ru",
      title: "Diagnostic approved content",
      slug: "diagnostic-approved-content",
      _meta: {
        dedupe_key:
          "00000000-0000-4000-8000-000000000924:content_qa",
      },
    },
  };
}

function createQaResult(
  status: "approved" | "rejected" = "approved",
): QaResult {
  return {
    content_id:
      "00000000-0000-4000-8000-000000000924",
    score: status === "approved" ? 1 : 0.5,
    status,
    checks: [],
  };
}

Deno.test(
  "buildPublishJob creates a stable publish contract",
  () => {
    const sourceJob = createQaJob();
    const publishJob = buildPublishJob(
      sourceJob,
      createQaResult(),
    );

    if (!publishJob) {
      throw new Error("Expected a publish job");
    }

    if (publishJob.agent !== "publisher") {
      throw new Error("Unexpected publisher agent");
    }

    if (publishJob.task_type !== "content_publish") {
      throw new Error("Unexpected publish task type");
    }

    if (publishJob.priority !== 100) {
      throw new Error("Unexpected publish priority");
    }

    if (
      publishJob.payload.source_qa_job_id !==
        sourceJob.id
    ) {
      throw new Error("Source QA job id was not preserved");
    }

    const expectedDedupeKey =
      `${sourceJob.payload.content_id}:content_publish`;

    if (
      publishJob.payload._meta.dedupe_key !==
        expectedDedupeKey
    ) {
      throw new Error("Unexpected publish dedupe key");
    }
  },
);

Deno.test(
  "buildPublishJob skips rejected content",
  () => {
    const publishJob = buildPublishJob(
      createQaJob(),
      createQaResult("rejected"),
    );

    if (publishJob !== null) {
      throw new Error(
        "Rejected content must not create a publish job",
      );
    }
  },
);

Deno.test(
  "enqueuePublishJob creates one new job",
  async () => {
    let createCalls = 0;

    const created = await enqueuePublishJob(
      {
        existsByDedupeKey: async () => false,
        createMany: () => {
          createCalls += 1;

          return Promise.resolve([
            {
              id: "00000000-0000-4000-8000-000000000925",
              dedupeKey:
                "00000000-0000-4000-8000-000000000924:content_publish",
            },
          ]);
        },
      },
      createQaJob(),
      createQaResult(),
    );

    if (!created || createCalls !== 1) {
      throw new Error("Expected one created publish job");
    }
  },
);

Deno.test(
  "enqueuePublishJob skips an existing dedupe key",
  async () => {
    let createCalls = 0;

    const created = await enqueuePublishJob(
      {
        existsByDedupeKey: async () => true,
        createMany: () => {
          createCalls += 1;
          return Promise.resolve([]);
        },
      },
      createQaJob(),
      createQaResult(),
    );

    if (created !== null || createCalls !== 0) {
      throw new Error(
        "Existing publish dedupe key must skip insertion",
      );
    }
  },
);
