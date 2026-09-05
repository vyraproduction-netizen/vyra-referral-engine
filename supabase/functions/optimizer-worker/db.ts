import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  OptimizationDecision,
  OptimizationSnapshot,
} from "./optimizer.ts";
import {
  buildContentOptimizationSnapshots,
} from "./content-snapshots.ts";
import {
  contentReferralMetricsFromStoredRows,
} from "./stored-content-metrics.ts";
import type {
  StoredContentReferralMetricRow,
} from "./stored-content-metrics.ts";
import {
  enqueueRepeatJobs,
} from "./repeat-persistence.ts";

const pageSize = 1000;

type ContentMetricRow = {
  id: string;
  status: string;
  referral_link_id: string | null;
};

type ReferralMetricRow = {
  id: string;
  status: string;
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
      .select("id, status")
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

async function loadStoredContentReferralMetrics(): Promise<
  StoredContentReferralMetricRow[]
> {
  const client = createSupabaseAdminClient();
  const rows: StoredContentReferralMetricRow[] = [];

  for (let from = 0;; from += pageSize) {
    const { data, error } = await client
      .from("content_referral_metrics")
      .select(
        "content_id, referral_link_id, clicks, conversions, revenue, last_click_at, last_conversion_at",
      )
      .order("content_id", { ascending: true })
      .order("referral_link_id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Optimizer content metrics fetch failed: ${error.message}`,
      );
    }

    const page = (data ?? []) as StoredContentReferralMetricRow[];
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
  const [contentRows, referralRows, storedMetrics] = await Promise.all([
    loadContentMetricRows(),
    loadReferralMetricRows(),
    loadStoredContentReferralMetrics(),
  ]);
  const metrics = contentReferralMetricsFromStoredRows(storedMetrics);

  return buildContentOptimizationSnapshots(
    contentRows,
    referralRows,
    metrics,
  );
}

export async function completeOptimizerJob(
  jobId: string,
  result: Record<string, unknown>,
) {
  const store = createSupabaseJobStore();
  await store.complete(jobId, result);
}

export async function createOptimizerRepeatJobs(
  jobId: string,
  requestId: string,
  decisions: OptimizationDecision[],
) {
  const store = createSupabaseJobStore();

  return await enqueueRepeatJobs(
    store,
    {
      job_id: jobId,
      request_id: requestId,
    },
    decisions,
  );
}

export async function retryOptimizerJob(
  jobId: string,
  errorMessage: string,
) {
  const store = createSupabaseJobStore();
  await store.retry(jobId, errorMessage);
}
