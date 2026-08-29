import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  QaContent,
  QaResult,
} from "./qa.ts";

export type LoadedQaContent = QaContent & {
  qa_score: number | string | null;
};

export async function claimQaJob() {
  const store = createSupabaseJobStore();
  return await store.claim("qa");
}

export async function loadContentForQa(
  contentId: string,
): Promise<LoadedQaContent> {
  const client = createSupabaseAdminClient();

  const { data, error } = await client
    .from("content")
    .select(
      "id, title, slug, language, status, body, excerpt, meta_title, meta_description, evidence, qa_score",
    )
    .eq("id", contentId)
    .single();

  if (error) {
    throw new Error(
      `QA content fetch failed: ${error.message}`,
    );
  }

  return data as LoadedQaContent;
}

export async function saveQaResult(
  result: QaResult,
) {
  const client = createSupabaseAdminClient();

  const { data, error } = await client
    .from("content")
    .update({
      qa_score: result.score,
      status: result.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", result.content_id)
    .in("status", ["draft", "qa"])
    .select("id, status, qa_score")
    .maybeSingle();

  if (error) {
    throw new Error(
      `QA content update failed: ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      "QA content was not in a writable state",
    );
  }

  return data;
}

export async function completeQaJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);
}

export async function retryQaJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);
}
