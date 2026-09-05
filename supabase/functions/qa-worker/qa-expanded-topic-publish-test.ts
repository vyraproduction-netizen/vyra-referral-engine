import type { QaJob, QaResult } from "./qa.ts";
import { buildPublishJob } from "./publish-job.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const topicExpansion = {
  lineage: {
    source_repeat_job_id: "00000000-0000-4000-8000-000000008500",
    source_content_id: "00000000-0000-4000-8000-000000008501",
    referral_link_id: "00000000-0000-4000-8000-000000008502",
    execution_dedupe_key: "runtime:expanded-topic:8500:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function createJob(value?: unknown): QaJob {
  return {
    id: "00000000-0000-4000-8000-000000008503",
    agent: "qa",
    task_type: "content_qa",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000008504",
      source_content_job_id: "00000000-0000-4000-8000-000000008505",
      source_research_job_id: "00000000-0000-4000-8000-000000008506",
      content_id: "00000000-0000-4000-8000-000000008507",
      language: "en",
      title: "Expanded topic publish fixture",
      slug: "expanded-topic-publish-fixture",
      ...(value === undefined ? {} : { topic_expansion: value }),
      _meta: {
        dedupe_key: "00000000-0000-4000-8000-000000008507:content_qa",
      },
    },
  } as QaJob;
}

function createResult(
  status: "approved" | "rejected" = "approved",
): QaResult {
  return {
    content_id: "00000000-0000-4000-8000-000000008507",
    score: status === "approved" ? 1 : 0.5,
    status,
    checks: [],
  };
}

Deno.test("propagates expanded-topic lineage to Publisher", () => {
  const publishJob = buildPublishJob(
    createJob(topicExpansion),
    createResult(),
  );

  assert(publishJob, "Expected a Publisher job");
  const resolved = publishJob.payload.topic_expansion;
  assert(resolved, "Publisher job lost expansion lineage");
  assert(
    resolved.lineage.source_repeat_job_id ===
      topicExpansion.lineage.source_repeat_job_id,
    "Publisher job changed the source Repeat job id",
  );
  assert(
    resolved.lineage.source_content_id ===
      topicExpansion.lineage.source_content_id,
    "Publisher job changed the source content id",
  );
  assert(
    resolved.lineage.referral_link_id ===
      topicExpansion.lineage.referral_link_id,
    "Publisher job changed the referral link id",
  );
  assert(
    resolved.lineage.execution_dedupe_key ===
      topicExpansion.lineage.execution_dedupe_key,
    "Publisher job changed the execution dedupe key",
  );
});

Deno.test("isolates Publisher lineage from the QA payload", () => {
  const sourceJob = createJob(topicExpansion);
  const publishJob = buildPublishJob(sourceJob, createResult());

  assert(publishJob, "Expected a Publisher job");
  const resolved = publishJob.payload.topic_expansion;
  assert(resolved, "Publisher job lost expansion lineage");
  assert(
    resolved !== sourceJob.payload.topic_expansion,
    "Publisher job reused QA metadata",
  );
  assert(
    resolved.lineage !== sourceJob.payload.topic_expansion?.lineage,
    "Publisher job reused QA lineage",
  );
  assert(
    resolved.safeguards !== sourceJob.payload.topic_expansion?.safeguards,
    "Publisher job reused QA safeguards",
  );
});

Deno.test("keeps ordinary Publisher jobs compatible", () => {
  const publishJob = buildPublishJob(createJob(), createResult());

  assert(publishJob, "Expected an ordinary Publisher job");
  assert(
    publishJob.payload.topic_expansion === undefined,
    "Ordinary Publisher job received expansion lineage",
  );
});

Deno.test("rejects invalid lineage before Publisher enqueue", () => {
  let rejected = false;

  try {
    buildPublishJob(
      createJob({
        ...topicExpansion,
        safeguards: {
          ...topicExpansion.safeguards,
          preserve_source_content: false,
        },
      }),
      createResult(),
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Invalid QA expansion lineage was accepted");
});

Deno.test("rejected QA does not validate or publish lineage", () => {
  const publishJob = buildPublishJob(
    createJob({ invalid: true }),
    createResult("rejected"),
  );

  assert(publishJob === null, "Rejected QA created a Publisher job");
});
