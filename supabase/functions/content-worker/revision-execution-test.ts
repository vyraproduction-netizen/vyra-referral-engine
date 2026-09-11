import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  createContentProvider,
} from "./content-provider.ts";
import {
  assertContentRevisionJob,
} from "./revision.ts";
import type {
  RevisionSourceContent,
} from "./revision.ts";
import {
  buildRevisionGenerationInput,
  runContentRevision,
} from "./revision-execution.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function fixture() {
  const job: VyraJob = {
    id: "00000000-0000-4000-8000-000000006700",
    agent: "content",
    task_type: "content_revision",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000006701",
      source_repeat_job_id:
        "00000000-0000-4000-8000-000000006702",
      source_content_id:
        "00000000-0000-4000-8000-000000006703",
      referral_link_id:
        "00000000-0000-4000-8000-000000006704",
      revision: {
        action: "improve_content",
        reason: "Improve qualified traffic conversion",
        priority: 80,
        metrics: {
          clicks: 20,
          conversions: 0,
          revenue: 0,
          conversion_rate: 0,
        },
      },
      safeguards: {
        preserve_source_content: true,
        allow_published_overwrite: false,
        reuse_source_slug: false,
      },
      _meta: {
        dedupe_key: "content:revision:execution:test",
      },
    },
  };
  assertContentRevisionJob(job);

  const source: RevisionSourceContent = {
    id: job.payload.source_content_id,
    title: "Published conversion guide",
    slug: "published-conversion-guide",
    content_type: "article",
    language: "ru",
    status: "published",
    body: "Original protected publication body",
    excerpt: "Original excerpt",
    meta_title: "Original meta title",
    meta_description: "Original meta description",
    evidence: {
      source: "revision-execution-test",
    },
    program_id:
      "00000000-0000-4000-8000-000000006705",
    referral_link_id: job.payload.referral_link_id,
    published_url:
      "https://example.local/published-conversion-guide",
  };

  return { job, source };
}

Deno.test(
  "builds revision generation input from the published source",
  () => {
    const { job, source } = fixture();
    const input = buildRevisionGenerationInput(
      job,
      source,
    );

    assert(
      input.research_answer === source.body,
      "Published body was not supplied to the provider",
    );
    assert(
      input.recommendation ===
        job.payload.revision.reason,
      "Revision reason was not supplied",
    );
    assert(
      input.url === source.published_url,
      "Published URL mismatch",
    );
  },
);

Deno.test(
  "creates a separate revision draft through the provider",
  async () => {
    const { job, source } = fixture();
    const draft = await runContentRevision(
      job,
      source,
      createContentProvider("mock"),
    );

    assert(draft.status === "draft", "Revision is not a draft");
    assert(
      draft.source_content_id === source.id,
      "Revision source id mismatch",
    );
    assert(
      draft.slug !== source.slug,
      "Revision reused the published slug",
    );
    assert(
      draft.body.includes(source.body as string),
      "Generated revision omitted the source body",
    );
    assert(
      source.body === "Original protected publication body",
      "Published source was mutated",
    );
  },
);

Deno.test(
  "passes the revision request to the provider exactly once",
  async () => {
    const { job, source } = fixture();
    let calls = 0;
    let receivedTopicSeed = "";

    await runContentRevision(
      job,
      source,
      (input) => {
        calls += 1;
        receivedTopicSeed = input.topic_seed;
        return Promise.resolve({
          title: "Improved title",
          body: "Improved body",
          excerpt: "Improved excerpt",
          meta_title: "Improved meta title",
          meta_description: "Improved meta description",
        });
      },
    );

    assert(calls === 1, "Provider call count mismatch");
    assert(
      receivedTopicSeed === source.slug,
      "Provider input mismatch",
    );
  },
);

Deno.test(
  "rejects a non-HTTPS published source before provider access",
  async () => {
    const { job, source } = fixture();
    source.published_url =
      "http://example.local/published-conversion-guide";
    let providerCalls = 0;
    let message = "";

    try {
      await runContentRevision(
        job,
        source,
        () => {
          providerCalls += 1;
          throw new Error("Unexpected provider call");
        },
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(providerCalls === 0, "Provider was accessed");
    assert(
      message ===
        "Published revision source URL must use HTTPS",
      "Unsafe published URL was accepted",
    );
  },
);
