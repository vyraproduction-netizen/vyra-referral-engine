import type {
  ContentReferralMetrics,
} from "./content-referral-metrics.ts";

export type StoredContentReferralMetricKey = {
  content_id: string;
  referral_link_id: string;
};

export type ContentReferralMetricUpsert = ContentReferralMetrics & {
  updated_at: string;
};

export type ContentReferralMetricSync = {
  upserts: ContentReferralMetricUpsert[];
  deletes: StoredContentReferralMetricKey[];
};

function requiredString(
  value: string,
  field: string,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function normalizedTimestamp(
  value: string,
  field: string,
): string {
  const timestamp = new Date(value);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`${field} is invalid`);
  }

  return timestamp.toISOString();
}

function optionalTimestamp(
  value: string | null,
  field: string,
): string | null {
  return value === null
    ? null
    : normalizedTimestamp(value, field);
}

function pairKey(
  contentId: string,
  referralLinkId: string,
): string {
  return `${contentId}:${referralLinkId}`;
}

function normalizedKey(
  item: StoredContentReferralMetricKey,
  field: string,
): StoredContentReferralMetricKey {
  return {
    content_id: requiredString(
      item.content_id,
      `${field} content id`,
    ),
    referral_link_id: requiredString(
      item.referral_link_id,
      `${field} referral link id`,
    ),
  };
}

function compareKeys(
  left: StoredContentReferralMetricKey,
  right: StoredContentReferralMetricKey,
): number {
  return left.content_id.localeCompare(right.content_id) ||
    left.referral_link_id.localeCompare(right.referral_link_id);
}

export function buildContentReferralMetricSync(
  existingRows: StoredContentReferralMetricKey[],
  metrics: ContentReferralMetrics[],
  updatedAt: string,
): ContentReferralMetricSync {
  const normalizedUpdatedAt = normalizedTimestamp(
    updatedAt,
    "Content referral metrics updated at",
  );
  const existingByPair = new Map<
    string,
    StoredContentReferralMetricKey
  >();

  for (const row of existingRows) {
    const normalized = normalizedKey(
      row,
      "Stored content referral metric",
    );
    const key = pairKey(
      normalized.content_id,
      normalized.referral_link_id,
    );

    if (existingByPair.has(key)) {
      throw new Error(`Duplicate stored content referral metric: ${key}`);
    }

    existingByPair.set(key, normalized);
  }

  const currentPairs = new Set<string>();
  const upserts = metrics.map((metric) => {
    const normalized = normalizedKey(
      metric,
      "Content referral metric",
    );
    const key = pairKey(
      normalized.content_id,
      normalized.referral_link_id,
    );

    if (currentPairs.has(key)) {
      throw new Error(`Duplicate content referral metric: ${key}`);
    }

    if (
      !Number.isInteger(metric.clicks) ||
      metric.clicks < 0 ||
      !Number.isInteger(metric.conversions) ||
      metric.conversions < 0 ||
      metric.conversions > metric.clicks
    ) {
      throw new Error(`Invalid content referral counters: ${key}`);
    }

    if (!Number.isFinite(metric.revenue) || metric.revenue < 0) {
      throw new Error(`Invalid content referral revenue: ${key}`);
    }

    currentPairs.add(key);

    return {
      ...normalized,
      clicks: metric.clicks,
      conversions: metric.conversions,
      revenue: Number(metric.revenue.toFixed(2)),
      last_click_at: optionalTimestamp(
        metric.last_click_at,
        `Content referral metric ${key} last click at`,
      ),
      last_conversion_at: optionalTimestamp(
        metric.last_conversion_at,
        `Content referral metric ${key} last conversion at`,
      ),
      updated_at: normalizedUpdatedAt,
    };
  }).sort(compareKeys);

  const deletes = [...existingByPair.entries()]
    .filter(([key]) => !currentPairs.has(key))
    .map(([, row]) => row)
    .sort(compareKeys);

  return { upserts, deletes };
}
