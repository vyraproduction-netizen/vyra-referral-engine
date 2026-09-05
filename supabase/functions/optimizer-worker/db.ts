import {
  createSupabaseAdminClient,
  createSupabaseJobStore,
} from "../_shared/vyra/supabase-job-store.ts";
import type {
  OptimizationDecision,
  OptimizationSnapshot,
} from "./optimizer.ts";
import {
  rollupContentReferralEvents,
} from "../analytics-worker/content-referral-metrics.ts";
import type {
  ContentAnalyticsEvent,
} from "../analytics-worker/content-referral-metrics.ts";
import {
  buildContentOptimizationSnapshots,
} from "./content-snapshots.ts";
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

async function loadContentAnalyticsEvents(): Promise<
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
      .not("content_id", "is", null)
      .not("referral_link_id", "is", null)
      .in("event_type", [
        "referral_click",
        "conversion",
        "commission",
      ])
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(
        `Optimizer analytics event fetch failed: ${error.message}`,
      );
    }

    const page = (data ?? []) as ContentAnalyticsEvent[];
    events.push(...page);

    if (page.length < pageSize) {
      break;
    }
  }

  return events;
}

export async function loadOptimizationSnapshots(): Promise<
  OptimizationSnapshot[]
> {
  const [contentRows, referralRows, analyticsEvents] = await Promise.all([
    loadContentMetricRows(),
    loadReferralMetricRows(),
    loadContentAnalyticsEvents(),
  ]);
  const metrics = rollupContentReferralEvents(analyticsEvents);

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
