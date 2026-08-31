import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  PublishResult,
  PublisherContent,
} from "./publisher.ts";

export async function claimPublisherJob() {
  const store = createSupabaseJobStore();
  return await store.claim("publisher");
}

export async function loadContentForPublish(
  contentId: string,
): Promise<PublisherContent> {
  const client = createSupabaseAdminClient();

  const { data, error } = await client
    .from("content")
    .select(
      "id, title, slug, language, status, body, excerpt, meta_title, meta_description, published_url",
    )
    .eq("id", contentId)
    .single();

  if (error) {
    throw new Error(
      `Publisher content fetch failed: ${error.message}`,
    );
  }

  return data as PublisherContent;
}

export async function savePublishResult(
  result: PublishResult,
) {
  const client = createSupabaseAdminClient();

  const { data, error } = await client
    .from("content")
    .update({
      published_url: result.published_url,
      status: "published",
      updated_at: new Date().toISOString(),
    })
    .eq("id", result.content_id)
    .eq("status", "approved")
    .select("id, slug, status, published_url")
    .maybeSingle();

  if (error) {
    throw new Error(
      `Publisher content update failed: ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      "Publisher content was not approved",
    );
  }

  return data;
}

export async function completePublisherJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);
}

export async function retryPublisherJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);
}
