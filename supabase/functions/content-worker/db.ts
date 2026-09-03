import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  ContentDraft,
  ContentJob,
} from "./content.ts";
import type {
  ContentRevisionDraft,
  ContentRevisionJob,
  RevisionSourceContent,
} from "./revision.ts";
import {
  persistContentRevision,
} from "./revision-persistence.ts";
import {
  enqueueRevisionQaJob,
} from "./revision-qa.ts";
import type {
  SavedContentRevision,
} from "./revision-rpc.ts";
import {
  enqueueQaJob,
} from "./qa-job.ts";
import type {
  SavedContentDraft,
} from "./qa-job.ts";

export async function claimContentJob() {
  const store = createSupabaseJobStore();
  return await store.claim("content");
}

export async function saveContentDraft(
  draft: ContentDraft,
) {
  const client = createSupabaseAdminClient();

  const { data: existing, error: existingError } =
    await client
      .from("content")
      .select("id, slug, status, evidence")
      .eq("slug", draft.slug)
      .maybeSingle();

  if (existingError) {
    throw new Error(
      `Content lookup failed: ${existingError.message}`,
    );
  }

  if (existing) {
    if (
      existing.evidence?.source_job_id !==
        draft.source_job_id
    ) {
      throw new Error(
        `Content slug collision: ${draft.slug}`,
      );
    }

    return {
      id: existing.id,
      slug: existing.slug,
      status: existing.status,
      created: false,
    };
  }

  const { data, error } = await client
    .from("content")
    .insert({
      title: draft.title,
      slug: draft.slug,
      content_type: draft.content_type,
      language: draft.language,
      status: draft.status,
      body: draft.body,
      excerpt: draft.excerpt,
      meta_title: draft.meta_title,
      meta_description: draft.meta_description,
      evidence: draft.evidence,
    })
    .select("id, slug, status")
    .single();

  if (error) {
    throw new Error(
      `Content insert failed: ${error.message}`,
    );
  }

  return {
    id: data.id,
    slug: data.slug,
    status: data.status,
    created: true,
  };
}

export async function loadContentRevisionSource(
  sourceContentId: string,
): Promise<RevisionSourceContent> {
  const client = createSupabaseAdminClient();

  const { data, error } = await client
    .from("content")
    .select(
      [
        "id",
        "title",
        "slug",
        "content_type",
        "language",
        "status",
        "body",
        "excerpt",
        "meta_title",
        "meta_description",
        "evidence",
        "program_id",
        "referral_link_id",
        "published_url",
      ].join(","),
    )
    .eq("id", sourceContentId)
    .single();

  if (error) {
    throw new Error(
      `Revision source lookup failed: ${error.message}`,
    );
  }

  return data as unknown as RevisionSourceContent;
}

export async function saveContentRevision(
  job: ContentRevisionJob,
  draft: ContentRevisionDraft,
): Promise<SavedContentRevision> {
  const client = createSupabaseAdminClient();

  return await persistContentRevision(
    (args) =>
      client.rpc("create_content_revision", args),
    job,
    draft,
  );
}

export async function createContentRevisionQaJob(
  job: ContentRevisionJob,
  draft: ContentRevisionDraft,
  saved: SavedContentRevision,
) {
  const store = createSupabaseJobStore();
  return await enqueueRevisionQaJob(
    store,
    job,
    draft,
    saved,
  );
}

export async function createContentQaJob(
  job: ContentJob,
  draft: ContentDraft,
  saved: SavedContentDraft,
) {
  const store = createSupabaseJobStore();
  return await enqueueQaJob(
    store,
    job,
    draft,
    saved,
  );
}

export async function completeContentJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);
}

export async function retryContentJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);
}
