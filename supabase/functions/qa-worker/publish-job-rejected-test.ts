import {
  enqueuePublishJob,
} from "./publish-job.ts";
import type {
  QaJob,
  QaResult,
} from "./qa.ts";

Deno.test(
  "enqueuePublishJob skips rejected content without store access",
  async () => {
    const sourceJob: QaJob = {
      id: "00000000-0000-4000-8000-000000000930",
      agent: "qa",
      task_type: "content_qa",
      status: "running",
      attempts: 1,
      max_attempts: 3,
      payload: {
        request_id:
          "00000000-0000-4000-8000-000000000931",
        source_content_job_id:
          "00000000-0000-4000-8000-000000000932",
        source_research_job_id:
          "00000000-0000-4000-8000-000000000933",
        content_id:
          "00000000-0000-4000-8000-000000000934",
        language: "ru",
        title: "Rejected diagnostic content",
        slug: "rejected-diagnostic-content",
        _meta: {
          dedupe_key:
            "00000000-0000-4000-8000-000000000934:content_qa",
        },
      },
    };

    const result: QaResult = {
      content_id: sourceJob.payload.content_id,
      score: 0.5,
      status: "rejected",
      checks: [],
    };

    let existsCalls = 0;
    let createCalls = 0;

    const created = await enqueuePublishJob(
      {
        existsByDedupeKey: async () => {
          existsCalls += 1;
          return false;
        },
        createMany: () => {
          createCalls += 1;
          return Promise.resolve([]);
        },
      },
      sourceJob,
      result,
    );

    if (
      created !== null ||
      existsCalls !== 0 ||
      createCalls !== 0
    ) {
      throw new Error(
        "Rejected content must not access the job store",
      );
    }
  },
);
