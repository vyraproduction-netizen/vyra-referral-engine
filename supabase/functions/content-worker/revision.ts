import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import type {
  ContentRevisionJobPayload,
} from "../repeat-worker/content-revision.ts";

export type ContentRevisionJob = VyraJob & {
  agent: "content";
  task_type: "content_revision";
  payload: ContentRevisionJobPayload;
};

export type RevisionSourceContent = {
  id: string;
  title: string;
  slug: string;
  content_type: string;
  language: string;
  status: string;
  body: string | null;
  excerpt: string | null;
  meta_title: string | null;
  meta_description: string | null;
  evidence: Record<string, unknown>;
  program_id: string | null;
  referral_link_id: string | null;
  published_url: string | null;
};

export type GeneratedRevision = {
  title: string;
  body: string;
  excerpt: string;
  meta_title: string;
  meta_description: string;
};

export type ContentRevisionDraft = {
  source_job_id: string;
  source_content_id: string;
  request_id: string;
  title: string;
  slug: string;
  content_type: "article";
  language: string;
  status: "draft";
  body: string;
  excerpt: string;
  meta_title: string;
  meta_description: string;
  evidence: Record<string, unknown>;
  program_id: string;
  referral_link_id: string;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

function nonNegativeNumber(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(
      `${field} must be a non-negative number`,
    );
  }

  return value;
}

export function assertContentRevisionJob(
  job: VyraJob,
): asserts job is ContentRevisionJob {
  if (job.agent !== "content") {
    throw new Error("Invalid content revision agent");
  }

  if (job.task_type !== "content_revision") {
    throw new Error("Invalid content revision task_type");
  }

  const payload = job.payload;

  if (!isRecord(payload)) {
    throw new Error(
      "Content revision payload is required",
    );
  }

  for (
    const field of [
      "request_id",
      "source_repeat_job_id",
      "source_content_id",
      "referral_link_id",
    ] as const
  ) {
    requiredString(
      payload[field],
      `Content revision payload.${field}`,
    );
  }

  if (!isRecord(payload.revision)) {
    throw new Error(
      "Content revision instructions are required",
    );
  }

  if (payload.revision.action !== "improve_content") {
    throw new Error(
      "Content revision action must be improve_content",
    );
  }

  requiredString(
    payload.revision.reason,
    "Content revision reason",
  );
  nonNegativeNumber(
    payload.revision.priority,
    "Content revision priority",
  );

  if (!isRecord(payload.revision.metrics)) {
    throw new Error(
      "Content revision metrics are required",
    );
  }

  for (
    const field of [
      "clicks",
      "conversions",
      "revenue",
      "conversion_rate",
    ] as const
  ) {
    nonNegativeNumber(
      payload.revision.metrics[field],
      `Content revision metrics.${field}`,
    );
  }

  if (!isRecord(payload.safeguards)) {
    throw new Error(
      "Content revision safeguards are required",
    );
  }

  if (
    payload.safeguards.preserve_source_content !== true ||
    payload.safeguards.allow_published_overwrite !== false ||
    payload.safeguards.reuse_source_slug !== false
  ) {
    throw new Error(
      "Unsafe content revision safeguards",
    );
  }

  if (!isRecord(payload._meta)) {
    throw new Error(
      "Content revision payload._meta is required",
    );
  }

  requiredString(
    payload._meta.dedupe_key,
    "Content revision dedupe key",
  );
}

export function createRevisionSlug(
  sourceSlug: string,
  contentRevisionJobId: string,
): string {
  const normalizedSlug = requiredString(
    sourceSlug,
    "Revision source slug",
  )
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const normalizedJobId = requiredString(
    contentRevisionJobId,
    "Content revision job id",
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  if (!normalizedSlug || !normalizedJobId) {
    throw new Error(
      "Unable to create content revision slug",
    );
  }

  return `${normalizedSlug}-revision-${normalizedJobId}`;
}

export function assertRevisionSource(
  job: ContentRevisionJob,
  source: RevisionSourceContent,
): void {
  if (source.id !== job.payload.source_content_id) {
    throw new Error(
      "Content revision source id mismatch",
    );
  }

  if (source.status !== "published") {
    throw new Error(
      "Content revision source must be published",
    );
  }

  requiredString(
    source.body,
    "Content revision source body",
  );

  if (!source.program_id) {
    throw new Error(
      "Content revision source program is required",
    );
  }

  if (
    source.referral_link_id !==
      job.payload.referral_link_id
  ) {
    throw new Error(
      "Content revision referral link mismatch",
    );
  }
}

export function buildContentRevisionDraft(
  job: ContentRevisionJob,
  source: RevisionSourceContent,
  generated: GeneratedRevision,
): ContentRevisionDraft {
  assertRevisionSource(job, source);

  const generatedFields = {
    title: requiredString(
      generated.title,
      "Generated revision title",
    ),
    body: requiredString(
      generated.body,
      "Generated revision body",
    ),
    excerpt: requiredString(
      generated.excerpt,
      "Generated revision excerpt",
    ),
    meta_title: requiredString(
      generated.meta_title,
      "Generated revision meta title",
    ),
    meta_description: requiredString(
      generated.meta_description,
      "Generated revision meta description",
    ),
  };

  return {
    source_job_id: job.id,
    source_content_id: source.id,
    request_id: job.payload.request_id,
    ...generatedFields,
    slug: createRevisionSlug(source.slug, job.id),
    content_type: "article",
    language: source.language,
    status: "draft",
    evidence: {
      ...source.evidence,
      revision: {
        source_content_id: source.id,
        source_repeat_job_id:
          job.payload.source_repeat_job_id,
        content_revision_job_id: job.id,
        reason: job.payload.revision.reason,
        metrics: {
          ...job.payload.revision.metrics,
        },
        safeguards: {
          ...job.payload.safeguards,
        },
      },
    },
    program_id: source.program_id as string,
    referral_link_id:
      source.referral_link_id as string,
  };
}
