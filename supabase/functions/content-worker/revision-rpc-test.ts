import type {
  ContentRevisionDraft,
  ContentRevisionJob,
} from "./revision.ts";
import {
  buildCreateContentRevisionArgs,
  parseContentRevisionResult,
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
    id: "00000000-0000-4000-8000-000000006500",
    agent: "content",
    task_type: "content_revision",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    priority: 80,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000006501",
      source_repeat_job_id:
        "00000000-0000-4000-8000-000000006502",
      source_content_id:
        "00000000-0000-4000-8000-000000006503",
      referral_link_id:
        "00000000-0000-4000-8000-000000006504",
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
        dedupe_key: "content:revision:rpc:test",
      },
    },
  } as ContentRevisionJob;

  const draft: ContentRevisionDraft = {
    source_job_id: job.id,
    source_content_id: job.payload.source_content_id,
    request_id: job.payload.request_id,
    title: "Improved diagnostic article",
    slug: "diagnostic-article-revision-6500",
    content_type: "article",
    language: "ru",
    status: "draft",
    body: "Improved body",
    excerpt: "Improved excerpt",
    meta_title: "Improved meta title",
    meta_description: "Improved meta description",
    evidence: {
      revision: {
        content_revision_job_id: job.id,
      },
    },
    program_id:
      "00000000-0000-4000-8000-000000006505",
    referral_link_id: job.payload.referral_link_id,
  };

  return { job, draft };
}

Deno.test(
  "builds the exact content revision RPC contract",
  () => {
    const { job, draft } = fixture();
    const args = buildCreateContentRevisionArgs(
      job,
      draft,
    );

    assert(
      args.p_revision_job_id === job.id,
      "Revision job id mismatch",
    );
    assert(
      args.p_source_content_id ===
        job.payload.source_content_id,
      "Source content id mismatch",
    );
    assert(
      args.p_referral_link_id ===
        job.payload.referral_link_id,
      "Referral link id mismatch",
    );
    assert(
      args.p_evidence === draft.evidence,
      "Revision evidence was replaced",
    );
  },
);

Deno.test(
  "parses a newly created content revision",
  () => {
    const { job, draft } = fixture();
    const saved = parseContentRevisionResult(
      {
        id: "00000000-0000-4000-8000-000000006506",
        slug: draft.slug,
        status: "draft",
        source_content_id: draft.source_content_id,
        revision_number: 1,
        revision_job_id: job.id,
        created: true,
      },
      job,
      draft,
    );

    assert(saved.created, "New revision was not created");
    assert(
      saved.revision_number === 1,
      "Revision number mismatch",
    );
  },
);

Deno.test(
  "parses an idempotently reused revision",
  () => {
    const { job, draft } = fixture();
    const saved = parseContentRevisionResult(
      {
        id: "00000000-0000-4000-8000-000000006506",
        slug: draft.slug,
        status: "draft",
        source_content_id: draft.source_content_id,
        revision_number: 1,
        revision_job_id: job.id,
        created: false,
      },
      job,
      draft,
    );

    assert(!saved.created, "Reused revision was marked new");
  },
);

Deno.test(
  "rejects a mismatched revision draft source",
  () => {
    const { job, draft } = fixture();
    draft.source_content_id =
      "00000000-0000-4000-8000-000000006599";
    let message = "";

    try {
      buildCreateContentRevisionArgs(job, draft);
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Revision draft source id mismatch",
      "Foreign revision source was accepted",
    );
  },
);

Deno.test(
  "rejects a mismatched saved revision job",
  () => {
    const { job, draft } = fixture();
    let message = "";

    try {
      parseContentRevisionResult(
        {
          id: "00000000-0000-4000-8000-000000006506",
          slug: draft.slug,
          status: "draft",
          source_content_id: draft.source_content_id,
          revision_number: 1,
          revision_job_id:
            "00000000-0000-4000-8000-000000006598",
          created: true,
        },
        job,
        draft,
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Saved revision job id mismatch",
      "Foreign revision job was accepted",
    );
  },
);

Deno.test(
  "rejects an invalid revision number",
  () => {
    const { job, draft } = fixture();
    let message = "";

    try {
      parseContentRevisionResult(
        {
          id: "00000000-0000-4000-8000-000000006506",
          slug: draft.slug,
          status: "draft",
          source_content_id: draft.source_content_id,
          revision_number: 0,
          revision_job_id: job.id,
          created: true,
        },
        job,
        draft,
      );
    } catch (error) {
      message = error instanceof Error
        ? error.message
        : String(error);
    }

    assert(
      message === "Saved revision number is invalid",
      "Invalid revision number was accepted",
    );
  },
);
