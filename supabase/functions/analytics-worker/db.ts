import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  ReferralMetrics,
} from "./analytics.ts";
import type {
  ContentAnalyticsEvent,
  ContentReferralMetrics,
} from "./content-referral-metrics.ts";
import {
  buildContentReferralMetricSync,
} from "./content-referral-persistence.ts";
import type {
  StoredContentReferralMetricKey,
} from "./content-referral-persistence.ts";

const pageSize = 1000;

export async function claimAnalyticsJob() {
  const store = createSupabaseJobStore();
  return await store.claim("analytics");
}

export async function loadReferralLinkIds(): Promise<
  string[]
> {
  const client = createSupabaseAdminClient();
  const ids: string[] = [];

  for (let from = 0;; from += pageSize) {
    const { data, error } = await client
      .from("referral_links")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Referral link fetch failed: ${error.message}`,
      );
    }

    const rows = data ?? [];
    ids.push(...rows.map((row) => row.id));

    if (rows.length < pageSize) {
      break;
    }
  }

  return ids;
}

export async function loadAnalyticsEvents(): Promise<
  ContentAnalyticsEvent[]
> {
  const client = createSupabaseAdminClient();
  const events: ContentAnalyticsEvent[] = [];

  for (let from = 0;; from += pageSize) {
    const { data, error } = await client
      .from("analytics_events")
      .select(
        "id, event_type, content_id, referral_link_id, value, created_at",
      )
      .not("referral_link_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Analytics event fetch failed: ${error.message}`,
      );
    }

    const rows = (data ?? []) as ContentAnalyticsEvent[];
    events.push(...rows);

    if (rows.length < pageSize) {
      break;
    }
  }

  return events;
}

async function loadStoredContentReferralMetricKeys(): Promise<
  StoredContentReferralMetricKey[]
> {
  const client = createSupabaseAdminClient();
  const rows: StoredContentReferralMetricKey[] = [];

  for (let from = 0;; from += pageSize) {
    const { data, error } = await client
      .from("content_referral_metrics")
      .select("content_id, referral_link_id")
      .order("content_id", { ascending: true })
      .order("referral_link_id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Content referral metric keys fetch failed: ${error.message}`,
      );
    }

    const page = (data ?? []) as StoredContentReferralMetricKey[];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

export async function saveContentReferralMetrics(
  metrics: ContentReferralMetrics[],
): Promise<void> {
  const client = createSupabaseAdminClient();
  const existingRows = await loadStoredContentReferralMetricKeys();
  const sync = buildContentReferralMetricSync(
    existingRows,
    metrics,
    new Date().toISOString(),
  );

  for (let from = 0; from < sync.upserts.length; from += pageSize) {
    const page = sync.upserts.slice(from, from + pageSize);
    const { error } = await client
      .from("content_referral_metrics")
      .upsert(page, {
        onConflict: "content_id,referral_link_id",
      });

    if (error) {
      throw new Error(
        `Content referral metrics upsert failed: ${error.message}`,
      );
    }
  }

  for (const item of sync.deletes) {
    const { error } = await client
      .from("content_referral_metrics")
      .delete()
      .eq("content_id", item.content_id)
      .eq("referral_link_id", item.referral_link_id);

    if (error) {
      throw new Error(
        `Content referral metric delete failed: ${error.message}`,
      );
    }
  }
}

export async function saveReferralMetrics(
  metrics: ReferralMetrics[],
): Promise<void> {
  const client = createSupabaseAdminClient();
  const updatedAt = new Date().toISOString();

  for (const item of metrics) {
    const { data, error } = await client
      .from("referral_links")
      .update({
        clicks: item.clicks,
        conversions: item.conversions,
        revenue: item.revenue,
        last_click_at: item.last_click_at,
        last_conversion_at:
          item.last_conversion_at,
        updated_at: updatedAt,
      })
      .eq("id", item.referral_link_id)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new Error(
        `Referral metrics update failed: ${error.message}`,
      );
    }

    if (!data) {
      throw new Error(
        `Referral link not found: ${item.referral_link_id}`,
      );
    }
  }
}

export async function completeAnalyticsJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);
}

export async function retryAnalyticsJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);
}
