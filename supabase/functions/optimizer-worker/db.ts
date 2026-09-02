import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  OptimizationSnapshot,
} from "./optimizer.ts";

const pageSize = 1000;

type ContentMetricRow = {
  id: string;
  status: string;
  referral_link_id: string | null;
};

type ReferralMetricRow = {
  id: string;
  status: string;
  clicks: number;
  conversions: number;
  revenue: number | string;
};

export async function claimOptimizerJob() {
  const store = createSupabaseJobStore();
  return await store.claim("optimizer");
}

async function loadContentMetricRows(): Promise<
  ContentMetricRow[]
> {
  const client = createSupabaseAdminClient();
  const rows: ContentMetricRow[] = [];

  for (let from = 0;; from += pageSize) {
    const { data, error } = await client
      .from("content")
      .select("id, status, referral_link_id")
      .not("referral_link_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Optimizer content fetch failed: ${error.message}`,
      );
    }

    const page = (data ?? []) as ContentMetricRow[];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

async function loadReferralMetricRows(): Promise<
  ReferralMetricRow[]
> {
  const client = createSupabaseAdminClient();
  const rows: ReferralMetricRow[] = [];

  for (let from = 0;; from += pageSize) {
    const { data, error } = await client
      .from("referral_links")
      .select("id, status, clicks, conversions, revenue")
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Optimizer referral metrics fetch failed: ${error.message}`,
      );
    }

    const page = (data ?? []) as ReferralMetricRow[];
    rows.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return rows;
}

export async function loadOptimizationSnapshots(): Promise<
  OptimizationSnapshot[]
> {
  const [contentRows, referralRows] = await Promise.all([
    loadContentMetricRows(),
    loadReferralMetricRows(),
  ]);
  const referralById = new Map(
    referralRows.map((row) => [row.id, row]),
  );

  return contentRows.map((content) => {
    const referralLinkId = content.referral_link_id;

    if (!referralLinkId) {
      throw new Error(
        `Optimizer content has no referral link: ${content.id}`,
      );
    }

    const referral = referralById.get(referralLinkId);

    if (!referral) {
      throw new Error(
        `Optimizer referral link not found: ${referralLinkId}`,
      );
    }

    return {
      content_id: content.id,
      referral_link_id: referral.id,
      content_status: content.status,
      referral_link_status: referral.status,
      clicks: referral.clicks,
      conversions: referral.conversions,
      revenue: referral.revenue,
    };
  });
}

export async function completeOptimizerJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);
}

export async function retryOptimizerJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);
}
