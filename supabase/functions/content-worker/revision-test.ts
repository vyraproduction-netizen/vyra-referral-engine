import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertContentRevisionJob,
  assertRevisionSource,
  buildContentRevisionDraft,
  createRevisionSlug,
} from "./revision.ts";
import type {
  ContentRevisionJob,
  GeneratedRevision,
  RevisionSourceContent,
} from "./revision.ts";

function createJob(): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000006100",
    agent: "content",
    task_type: "content_revision",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000006101",
      source_repeat_job_id:
        "00000000-0000-4000-8000-000000006102",
      source_content_id:
        "00000000-0000-4000-8000-000000006103",
      referral_link_id:
        "00000000-0000-4000-8000-000000006104",
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
        dedupe_key:
          "runtime:revision:6100:content_revision",
      },
    },
  };
}

function createSource(): RevisionSourceContent {
  return {
    id: "00000000-0000-4000-8000-000000006103",
    title: "Published source",
    slug: "published-source",
    content_type: "article",
    language: "ru",
    status: "published",
    body: "Original published body",
    excerpt: "Original excerpt",
    meta_title: "Original meta title",
    meta_description: "Original meta description",
    evidence: {
      source: "runtime-test",
    },
    program_id:
      "00000000-0000-4000-8000-000000006105",
    referral_link_id:
      "00000000-0000-4000-8000-000000006104",
    published_url:
      "https://example.local/published-source",
  };
}

const generated: GeneratedRevision = {
  title: "Improved source",
  body: "Improved draft body",
  excerpt: "Improved excerpt",
  meta_title: "Improved meta title",
  meta_description: "Improved meta description",
};

Deno.test(
  "accepts a safe content revision contract",
  () => {
    const job = createJob();
    assertContentRevisionJob(job);
  },
);

Deno.test(
  "creates a stable revision slug without reusing the source slug",
  () => {
    const jobId =
      "00000000-0000-4000-8000-000000006100";
    const first = createRevisionSlug(
      "Published Source",
      jobId,
    );
    const second = createRevisionSlug(
      "Published Source",
      jobId,
    );

    if (
      first !==
        "published-source-revision-00000000000040008000000000006100" ||
      first !== second
    ) {
      throw new Error(`Unexpected revision slug: ${first}`);
    }
  },
);

Deno.test(
  "rejects unsafe overwrite safeguards",
  () => {
    const job = createJob();
    assertContentRevisionJob(job);
    const safeguards = job.payload
      .safeguards as Record<string, unknown>;
    safeguards.allow_published_overwrite = true;

    let rejected = false;

    try {
      assertContentRevisionJob(job);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Unsafe overwrite safeguards were accepted",
      );
    }
  },
);

Deno.test(
  "rejects an unpublished revision source",
  () => {
    const job = createJob();
    assertContentRevisionJob(job);
    const source = {
      ...createSource(),
      status: "draft",
    };

    let rejected = false;

    try {
      assertRevisionSource(job, source);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Unpublished revision source was accepted",
      );
    }
  },
);

Deno.test(
  "rejects a mismatched source content id",
  () => {
    const job = createJob();
    assertContentRevisionJob(job);
    const source = {
      ...createSource(),
      id: "00000000-0000-4000-8000-000000006199",
    };

    let rejected = false;

    try {
      assertRevisionSource(job, source);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Mismatched revision source was accepted",
      );
    }
  },
);

Deno.test(
  "rejects a foreign referral link",
  () => {
    const job = createJob();
    assertContentRevisionJob(job);
    const source = {
      ...createSource(),
      referral_link_id:
        "00000000-0000-4000-8000-000000006199",
    };

    let rejected = false;

    try {
      assertRevisionSource(job, source);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Foreign referral link was accepted",
      );
    }
  },
);

Deno.test(
  "builds a separate draft with revision lineage",
  () => {
    const job = createJob();
    assertContentRevisionJob(job);
    const source = createSource();
    const draft = buildContentRevisionDraft(
      job,
      source,
      generated,
    );
    const revision = draft.evidence
      .revision as Record<string, unknown>;

    if (draft.status !== "draft") {
      throw new Error("Revision was not a draft");
    }

    if (draft.slug === source.slug) {
      throw new Error("Revision reused the source slug");
    }

    if (
      revision.source_content_id !== source.id ||
      revision.content_revision_job_id !== job.id
    ) {
      throw new Error(
        "Revision lineage was not preserved",
      );
    }

    if (
      draft.program_id !== source.program_id ||
      draft.referral_link_id !==
        source.referral_link_id
    ) {
      throw new Error(
        "Revision monetization links were not preserved",
      );
    }

    if (source.body !== "Original published body") {
      throw new Error("Published source was mutated");
    }
  },
);
