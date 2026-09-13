import type {
  ContentReferralMetrics,
} from "../analytics-worker/content-referral-metrics.ts";
import type { OptimizationSnapshot } from "./optimizer.ts";

export type OptimizationContentRow = {
  id: string;
  status: string;
  referral_link_id: string | null;
};

export type OptimizationReferralRow = {
  id: string;
  status: string;
};

function requiredString(
  value: string | null,
  field: string,
): string {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function uniqueById<T extends { id: string }>(
  rows: T[],
  field: string,
): Map<string, T> {
  const result = new Map<string, T>();

  for (const row of rows) {
    const id = requiredString(row.id, field);

    if (result.has(id)) {
      throw new Error(`Duplicate ${field}: ${id}`);
    }

    result.set(id, row);
  }

  return result;
}

export function buildContentOptimizationSnapshots(
  contentRows: OptimizationContentRow[],
  referralRows: OptimizationReferralRow[],
  metrics: ContentReferralMetrics[],
): OptimizationSnapshot[] {
  const referralById = uniqueById(
    referralRows,
    "Optimizer referral link id",
  );
  const metricsByPair = new Map<string, ContentReferralMetrics>();

  for (const item of metrics) {
    const contentId = requiredString(
      item.content_id,
      "Optimizer metric content id",
    );
    const referralLinkId = requiredString(
      item.referral_link_id,
      "Optimizer metric referral link id",
    );
    const key = `${contentId}:${referralLinkId}`;

    if (metricsByPair.has(key)) {
      throw new Error(`Duplicate Optimizer content metric: ${key}`);
    }

    metricsByPair.set(key, item);
  }

  return [...contentRows]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((content) => {
      const contentId = requiredString(
        content.id,
        "Optimizer content id",
      );
      const referralLinkId = requiredString(
        content.referral_link_id,
        `Optimizer content ${contentId} referral link id`,
      );
      const referral = referralById.get(referralLinkId);

      if (!referral) {
        throw new Error(
          `Optimizer referral link not found: ${referralLinkId}`,
        );
      }

      const metric = metricsByPair.get(
        `${contentId}:${referralLinkId}`,
      );

      return {
        content_id: contentId,
        referral_link_id: referralLinkId,
        content_status: content.status,
        referral_link_status: referral.status,
        clicks: metric?.clicks ?? 0,
        conversions: metric?.conversions ?? 0,
        revenue: metric?.revenue ?? 0,
      };
    });
}
