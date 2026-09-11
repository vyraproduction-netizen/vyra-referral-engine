import type { VyraJob } from "../_shared/vyra/job-store.ts";
import { createPublisherProvider } from "./publisher-provider.ts";
import { assertPublisherJob, runPublisher } from "./publisher.ts";
import type { PublisherContent } from "./publisher.ts";

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
    source_repeat_job_id: "00000000-0000-4000-8000-000000008700",
    source_content_id: "00000000-0000-4000-8000-000000008701",
    referral_link_id: "00000000-0000-4000-8000-000000008702",
    execution_dedupe_key: "runtime:expanded-topic:8700:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function createJob(value?: unknown): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000008703",
    agent: "publisher",
    task_type: "content_publish",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000008704",
      source_qa_job_id: "00000000-0000-4000-8000-000000008705",
      source_content_job_id: "00000000-0000-4000-8000-000000008706",
      source_research_job_id: "00000000-0000-4000-8000-000000008707",
      content_id: "00000000-0000-4000-8000-000000008708",
      language: "en",
      title: "Expanded topic publication fixture",
      slug: "expanded-topic-publication-fixture",
      qa_score: 1,
      ...(value === undefined ? {} : { topic_expansion: value }),
      _meta: {
        dedupe_key: "00000000-0000-4000-8000-000000008708:content_publish",
      },
    },
  };
}

function createContent(): PublisherContent {
  return {
    id: "00000000-0000-4000-8000-000000008708",
    title: "Expanded topic publication fixture",
    slug: "expanded-topic-publication-fixture",
    language: "en",
    status: "approved",
    body: "Expanded topic publication body.",
    excerpt: "Expanded topic publication excerpt.",
    meta_title: "Expanded topic publication fixture",
    meta_description: "Expanded topic publication description.",
    published_url: null,
  };
}

Deno.test("preserves expanded-topic lineage in publish result", async () => {
  const job = createJob(topicExpansion);
  assertPublisherJob(job);

  const result = await runPublisher(
    job,
    createContent(),
    createPublisherProvider("mock"),
  );

  const resolved = result.topic_expansion;
  assert(resolved, "Publish result lost expansion lineage");
  assert(
    resolved.lineage.source_repeat_job_id ===
      topicExpansion.lineage.source_repeat_job_id,
    "Publish result changed the source Repeat job id",
  );
  assert(
    resolved.lineage.source_content_id ===
      topicExpansion.lineage.source_content_id,
    "Publish result changed the source content id",
  );
  assert(
    resolved.lineage.referral_link_id ===
      topicExpansion.lineage.referral_link_id,
    "Publish result changed the referral link id",
  );
  assert(
    resolved.lineage.execution_dedupe_key ===
      topicExpansion.lineage.execution_dedupe_key,
    "Publish result changed the execution dedupe key",
  );
});

Deno.test("isolates result lineage from Publisher payload", async () => {
  const job = createJob(topicExpansion);
  assertPublisherJob(job);
  const result = await runPublisher(
    job,
    createContent(),
    createPublisherProvider("mock"),
  );

  const resolved = result.topic_expansion;
  assert(resolved, "Publish result lost expansion lineage");
  assert(
    resolved !== job.payload.topic_expansion,
    "Publish result reused Publisher metadata",
  );
  assert(
    resolved.lineage !== job.payload.topic_expansion?.lineage,
    "Publish result reused Publisher lineage",
  );
  assert(
    resolved.safeguards !== job.payload.topic_expansion?.safeguards,
    "Publish result reused Publisher safeguards",
  );
});

Deno.test("keeps ordinary publish results compatible", async () => {
  const job = createJob();
  assertPublisherJob(job);
  const result = await runPublisher(
    job,
    createContent(),
    createPublisherProvider("mock"),
  );

  assert(
    result.topic_expansion === undefined,
    "Ordinary result received expansion lineage",
  );
});

Deno.test("rejects invalid lineage before provider delivery", async () => {
  const job = createJob({
    ...topicExpansion,
    safeguards: {
      ...topicExpansion.safeguards,
      require_source_topic: false,
    },
  });
  assertPublisherJob(job);
  let rejected = false;

  try {
    await runPublisher(
      job,
      createContent(),
      createPublisherProvider("mock"),
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Invalid expansion lineage reached provider delivery");
});
