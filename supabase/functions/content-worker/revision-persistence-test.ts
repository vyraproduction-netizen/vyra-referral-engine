import type {
  ContentRevisionDraft,
  ContentRevisionJob,
} from "./revision.ts";
import {
  persistContentRevision,
} from "./revision-persistence.ts";

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
    id: "00000000-0000-4000-8000-000000006600",
    agent: "content",
    task_type: "content_revision",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    priority: 80,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000006601",
      source_repeat_job_id:
        "00000000-0000-4000-8000-000000006602",
      source_content_id:
        "00000000-0000-4000-8000-000000006603",
      referral_link_id:
        "00000000-0000-4000-8000-000000006604",
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
        dedupe_key: "content:revision:persistence:test",
      },
    },
  } as ContentRevisionJob;

  const draft: ContentRevisionDraft = {
    source_job_id: job.id,
    source_content_id: job.payload.source_content_id,
    request_id: job.payload.request_id,
    title: "Persisted revision",
    slug: "persisted-revision-6600",
    content_type: "article",
    language: "ru",
    status: "draft",
    body: "Persisted revision body",
    excerpt: "Persisted revision excerpt",
    meta_title: "Persisted revision title",
    meta_description: "Persisted revision description",
    evidence: {
      revision: {
        content_revision_job_id: job.id,
      },
    },
    program_id:
      "00000000-0000-4000-8000-000000006605",
    referral_link_id: job.payload.referral_link_id,
  };

  return { job, draft };
}

Deno.test(
  "persists a content revision through the RPC",
  async () => {
    const { job, draft } = fixture();
    let called = 0;

    const saved = await persistContentRevision(
      (args) => {
        called += 1;
        assert(
          args.p_revision_job_id === job.id,
          "RPC received the wrong job id",
        );
        return Promise.resolve({
          data: {
            id:
              "00000000-0000-4000-8000-000000006606",
            slug: draft.slug,
            status: "draft",
            source_content_id: draft.source_content_id,
            revision_number: 1,
            revision_job_id: job.id,
            created: true,
          },
          error: null,
        });
      },
      job,
      draft,
    );

    assert(called === 1, "RPC call count mismatch");
    assert(saved.created, "Revision was not created");
    assert(
      saved.revision_number === 1,
      "Revision number mismatch",
    );
  },
);

Deno.test(
  "preserves an idempotently reused revision",
  async () => {
    const { job, draft } = fixture();

    const saved = await persistContentRevision(
      () =>
        Promise.resolve({
          data: {
            id:
              "00000000-0000-4000-8000-000000006606",
            slug: draft.slug,
            status: "draft",
            source_content_id: draft.source_content_id,
            revision_number: 1,
            revision_job_id: job.id,
            created: false,
          },
          error: null,
        }),
      job,
      draft,
    );

    assert(!saved.created, "Reused revision was marked new");
  },
);

Deno.test(
  "surfaces a content revision RPC error",
  async () => {
    const { job, draft } = fixture();
    let message = "";

    try {
      await persistContentRevision(
        () =>
          Promise.resolve({
            data: null,
            error: {
              message: "Revision job id collision",
            },
          }),
        job,
        draft,
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Content revision persistence failed: " +
          "Revision job id collision",
      "RPC error was not preserved",
    );
  },
);

Deno.test(
  "rejects invalid RPC data",
  async () => {
    const { job, draft } = fixture();
    let message = "";

    try {
      await persistContentRevision(
        () =>
          Promise.resolve({
            data: null,
            error: null,
          }),
        job,
        draft,
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message ===
        "Content revision RPC returned invalid data",
      "Invalid RPC data was accepted",
    );
  },
);
