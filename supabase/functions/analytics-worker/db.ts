import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  AnalyticsEvent,
  ReferralMetrics,
} from "./analytics.ts";

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
  AnalyticsEvent[]
> {
  const client = createSupabaseAdminClient();
  const events: AnalyticsEvent[] = [];

  for (let from = 0;; from += pageSize) {
    const { data, error } = await client
      .from("analytics_events")
      .select(
        "id, event_type, referral_link_id, value, created_at",
      )
      .not("referral_link_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Analytics event fetch failed: ${error.message}`,
      );
    }

    const rows = (data ?? []) as AnalyticsEvent[];
    events.push(...rows);

    if (rows.length < pageSize) {
      break;
    }
  }

  return events;
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
