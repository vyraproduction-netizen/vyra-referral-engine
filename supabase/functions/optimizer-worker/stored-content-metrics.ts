import type {
  ContentReferralMetrics,
} from "../analytics-worker/content-referral-metrics.ts";

export type StoredContentReferralMetricRow = {
  content_id: string;
  referral_link_id: string;
  clicks: number;
  conversions: number;
  revenue: number;
  last_click_at: string | null;
  last_conversion_at: string | null;
};

function requiredString(value: string, field: string): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function optionalTimestamp(
  value: string | null,
  field: string,
): string | null {
  if (value === null) {
    return null;
  }

  const timestamp = new Date(value);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${field} is invalid`);
  }

  return timestamp.toISOString();
}

function pairKey(item: {
  content_id: string;
  referral_link_id: string;
}): string {
  return `${item.content_id}:${item.referral_link_id}`;
}

export function contentReferralMetricsFromStoredRows(
  rows: StoredContentReferralMetricRow[],
): ContentReferralMetrics[] {
  const seen = new Set<string>();

  return rows.map((row) => {
    const contentId = requiredString(
      row.content_id,
      "Stored content metric content id",
    );
    const referralLinkId = requiredString(
      row.referral_link_id,
      "Stored content metric referral link id",
    );
    const key = pairKey({
      content_id: contentId,
      referral_link_id: referralLinkId,
    });

    if (seen.has(key)) {
      throw new Error(`Duplicate stored content metric: ${key}`);
    }

    if (
      !Number.isInteger(row.clicks) ||
      row.clicks < 0 ||
      !Number.isInteger(row.conversions) ||
      row.conversions < 0 ||
      row.conversions > row.clicks
    ) {
      throw new Error(`Invalid stored content metric counters: ${key}`);
    }

    if (!Number.isFinite(row.revenue) || row.revenue < 0) {
      throw new Error(`Invalid stored content metric revenue: ${key}`);
    }

    seen.add(key);

    return {
      content_id: contentId,
      referral_link_id: referralLinkId,
      clicks: row.clicks,
      conversions: row.conversions,
      revenue: Number(row.revenue.toFixed(2)),
      last_click_at: optionalTimestamp(
        row.last_click_at,
        `Stored content metric ${key} last click at`,
      ),
      last_conversion_at: optionalTimestamp(
        row.last_conversion_at,
        `Stored content metric ${key} last conversion at`,
      ),
    };
  }).sort((left, right) =>
    left.content_id.localeCompare(right.content_id) ||
    left.referral_link_id.localeCompare(right.referral_link_id)
  );
}
