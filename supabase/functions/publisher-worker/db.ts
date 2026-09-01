import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import {
  renderMonetizedBody,
  resolveContentCandidateUrl,
  selectMonetizationPlacement,
} from "./monetization.ts";
import type {
  MonetizationContent,
  MonetizationPlacement,
  MonetizationProgram,
  MonetizationReferralLink,
} from "./monetization.ts";
import type {
  PublishResult,
  PublisherContent,
} from "./publisher.ts";

export type LoadedPublisherContent =
  PublisherContent & MonetizationContent & {
    program_id: string | null;
    referral_link_id: string | null;
    monetized_at: string | null;
  };

export async function claimPublisherJob() {
  const store = createSupabaseJobStore();
  return await store.claim("publisher");
}

export async function loadContentForPublish(
  contentId: string,
): Promise<LoadedPublisherContent> {
  const client = createSupabaseAdminClient();

  const { data, error } = await client
    .from("content")
    .select(
      "id, title, slug, language, status, body, excerpt, meta_title, meta_description, evidence, published_url, program_id, referral_link_id, monetized_at",
    )
    .eq("id", contentId)
    .single();

  if (error) {
    throw new Error(
      `Publisher content fetch failed: ${error.message}`,
    );
  }

  return data as LoadedPublisherContent;
}

export async function loadMonetizationForPublish(
  content: LoadedPublisherContent,
): Promise<MonetizationPlacement | null> {
  const candidateUrl = resolveContentCandidateUrl(
    content,
  );

  if (!candidateUrl) {
    return null;
  }

  const client = createSupabaseAdminClient();
  const { data: program, error: programError } =
    await client
      .from("programs")
      .select(
        "id, official_url, status, terms_verified",
      )
      .eq("official_url", candidateUrl)
      .eq("status", "active")
      .eq("terms_verified", true)
      .maybeSingle();

  if (programError) {
    throw new Error(
      `Publisher program fetch failed: ${programError.message}`,
    );
  }

  if (!program) {
    return null;
  }

  const { data: referralLinks, error: linksError } =
    await client
      .from("referral_links")
      .select(
        "id, program_id, url, source, status",
      )
      .eq("program_id", program.id)
      .eq("status", "active")
      .order("id", { ascending: true });

  if (linksError) {
    throw new Error(
      `Publisher referral link fetch failed: ${linksError.message}`,
    );
  }

  return selectMonetizationPlacement(
    content,
    [program as MonetizationProgram],
    (referralLinks ?? []) as
      MonetizationReferralLink[],
  );
}

export async function savePublishResult(
  result: PublishResult,
  content: LoadedPublisherContent,
) {
  if (!content.body?.trim()) {
    throw new Error(
      "Publisher content body is required for persistence",
    );
  }

  const client = createSupabaseAdminClient();
  const updatedAt = new Date().toISOString();
  const publishedBody = result.monetization
    ? renderMonetizedBody(
      content.body,
      result.monetization,
      content.language,
    )
    : content.body;

  const { data, error } = await client
    .from("content")
    .update({
      body: publishedBody,
      published_url: result.published_url,
      status: "published",
      program_id:
        result.monetization?.program_id ?? null,
      referral_link_id:
        result.monetization?.referral_link_id ?? null,
      monetized_at: result.monetization
        ? updatedAt
        : null,
      updated_at: updatedAt,
    })
    .eq("id", result.content_id)
    .eq("status", "approved")
    .select(
      "id, slug, status, published_url, program_id, referral_link_id, monetized_at",
    )
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
