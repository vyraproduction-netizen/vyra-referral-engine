import type {
  ContentRevisionDraft,
  ContentRevisionJob,
} from "./revision.ts";

export type CreateContentRevisionArgs = {
  p_revision_job_id: string;
  p_source_content_id: string;
  p_referral_link_id: string;
  p_title: string;
  p_slug: string;
  p_body: string;
  p_excerpt: string;
  p_meta_title: string;
  p_meta_description: string;
  p_evidence: Record<string, unknown>;
};

export type SavedContentRevision = {
  id: string;
  slug: string;
  status: "draft";
  source_content_id: string;
  revision_number: number;
  revision_job_id: string;
  created: boolean;
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

export function buildCreateContentRevisionArgs(
  job: ContentRevisionJob,
  draft: ContentRevisionDraft,
): CreateContentRevisionArgs {
  if (draft.source_job_id !== job.id) {
    throw new Error("Revision draft job id mismatch");
  }

  if (
    draft.source_content_id !==
      job.payload.source_content_id
  ) {
    throw new Error("Revision draft source id mismatch");
  }

  if (
    draft.referral_link_id !==
      job.payload.referral_link_id
  ) {
    throw new Error("Revision draft referral link mismatch");
  }

  if (draft.status !== "draft") {
    throw new Error("Revision draft status is invalid");
  }

  return {
    p_revision_job_id: job.id,
    p_source_content_id: draft.source_content_id,
    p_referral_link_id: draft.referral_link_id,
    p_title: requiredString(
      draft.title,
      "Revision title",
    ),
    p_slug: requiredString(
      draft.slug,
      "Revision slug",
    ),
    p_body: requiredString(
      draft.body,
      "Revision body",
    ),
    p_excerpt: requiredString(
      draft.excerpt,
      "Revision excerpt",
    ),
    p_meta_title: requiredString(
      draft.meta_title,
      "Revision meta title",
    ),
    p_meta_description: requiredString(
      draft.meta_description,
      "Revision meta description",
    ),
    p_evidence: draft.evidence,
  };
}

export function parseContentRevisionResult(
  value: unknown,
  job: ContentRevisionJob,
  draft: ContentRevisionDraft,
): SavedContentRevision {
  if (!isRecord(value)) {
    throw new Error("Content revision RPC returned invalid data");
  }

  const id = requiredString(
    value.id,
    "Saved revision id",
  );
  const slug = requiredString(
    value.slug,
    "Saved revision slug",
  );
  const sourceContentId = requiredString(
    value.source_content_id,
    "Saved revision source id",
  );
  const revisionJobId = requiredString(
    value.revision_job_id,
    "Saved revision job id",
  );

  if (value.status !== "draft") {
    throw new Error("Saved revision status is invalid");
  }

  if (
    !Number.isInteger(value.revision_number) ||
    (value.revision_number as number) < 1
  ) {
    throw new Error("Saved revision number is invalid");
  }

  if (typeof value.created !== "boolean") {
    throw new Error("Saved revision created flag is invalid");
  }

  if (slug !== draft.slug) {
    throw new Error("Saved revision slug mismatch");
  }

  if (sourceContentId !== job.payload.source_content_id) {
    throw new Error("Saved revision source id mismatch");
  }

  if (revisionJobId !== job.id) {
    throw new Error("Saved revision job id mismatch");
  }

  return {
    id,
    slug,
    status: "draft",
    source_content_id: sourceContentId,
    revision_number: value.revision_number as number,
    revision_job_id: revisionJobId,
    created: value.created,
  };
}
