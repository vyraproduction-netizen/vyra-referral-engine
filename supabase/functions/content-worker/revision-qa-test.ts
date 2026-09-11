import type {
  ContentRevisionDraft,
  ContentRevisionJob,
} from "./revision.ts";
import {
  buildRevisionQaJob,
  enqueueRevisionQaJob,
} from "./revision-qa.ts";
import type {
  SavedContentRevision,
} from "./revision-rpc.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function fixture() {
  const job = {
    id: "00000000-0000-4000-8000-000000006800",
    agent: "content",
    task_type: "content_revision",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    priority: 80,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000006801",
      source_repeat_job_id:
        "00000000-0000-4000-8000-000000006802",
      source_content_id:
        "00000000-0000-4000-8000-000000006803",
      referral_link_id:
        "00000000-0000-4000-8000-000000006804",
      revision: {
        action: "improve_content",
        reason: "Qualified traffic has no conversions",
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
        dedupe_key: "content:revision:qa:test",
      },
    },
  } as ContentRevisionJob;

  const draft: ContentRevisionDraft = {
    source_job_id: job.id,
    source_content_id: job.payload.source_content_id,
    request_id: job.payload.request_id,
    title: "Revision awaiting QA",
    slug: "revision-awaiting-qa-6800",
    content_type: "article",
    language: "ru",
    status: "draft",
    body: "Revision body awaiting QA",
    excerpt: "Revision excerpt awaiting QA",
    meta_title: "Revision meta title",
    meta_description: "Revision meta description awaiting QA",
    evidence: {
      source_job_id:
        "00000000-0000-4000-8000-000000006805",
      revision: {
        content_revision_job_id: job.id,
      },
    },
    program_id:
      "00000000-0000-4000-8000-000000006806",
    referral_link_id: job.payload.referral_link_id,
  };

  const saved: SavedContentRevision = {
    id: "00000000-0000-4000-8000-000000006807",
    slug: draft.slug,
    status: "draft",
    source_content_id: draft.source_content_id,
    revision_number: 1,
    revision_job_id: job.id,
    created: true,
  };

  return { job, draft, saved };
}

Deno.test(
  "builds QA lineage for a content revision",
  () => {
    const { job, draft, saved } = fixture();
    const qaJob = buildRevisionQaJob(
      job,
      draft,
      saved,
    );

    assert(
      qaJob.payload.source_content_job_id === job.id,
      "Revision content job id mismatch",
    );
    assert(
      qaJob.payload.source_research_job_id ===
        draft.evidence.source_job_id,
      "Original research job id was not preserved",
    );
    assert(
      qaJob.payload._meta.source_kind ===
        "content_revision",
      "Revision QA source kind mismatch",
    );
    assert(
      qaJob.payload._meta.revision_number === 1,
      "Revision number was not preserved",
    );
  },
);

Deno.test(
  "reuses an existing revision QA dedupe key",
  async () => {
    const { job, draft, saved } = fixture();
    let createCalls = 0;

    const created = await enqueueRevisionQaJob(
      {
        existsByDedupeKey: () =>
          Promise.resolve(true),
        createMany: () => {
          createCalls += 1;
          return Promise.resolve([]);
        },
      },
      job,
      draft,
      saved,
    );

    assert(created === null, "Duplicate QA job was created");
    assert(createCalls === 0, "QA store was accessed");
  },
);

Deno.test(
  "creates one revision QA job",
  async () => {
    const { job, draft, saved } = fixture();
    let inserted = 0;

    const created = await enqueueRevisionQaJob(
      {
        existsByDedupeKey: () =>
          Promise.resolve(false),
        createMany: (jobs) => {
          inserted = jobs.length;
          return Promise.resolve([{
            id:
              "00000000-0000-4000-8000-000000006808",
            dedupeKey: `${saved.id}:content_qa`,
          }]);
        },
      },
      job,
      draft,
      saved,
    );

    assert(inserted === 1, "Unexpected QA insert count");
    assert(created !== null, "Revision QA job was not created");
  },
);

Deno.test(
  "rejects missing original research lineage",
  () => {
    const { job, draft, saved } = fixture();
    delete draft.evidence.source_job_id;
    let message = "";

    try {
      buildRevisionQaJob(job, draft, saved);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Revision source research job id is required",
      "Missing research lineage was accepted",
    );
  },
);

Deno.test(
  "rejects a mismatched revision job lineage",
  () => {
    const { job, draft, saved } = fixture();
    saved.revision_job_id =
      "00000000-0000-4000-8000-000000006899";
    let message = "";

    try {
      buildRevisionQaJob(job, draft, saved);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Revision QA job lineage mismatch",
      "Foreign revision job lineage was accepted",
    );
  },
);
