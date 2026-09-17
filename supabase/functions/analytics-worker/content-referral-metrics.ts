import type { AnalyticsEventType } from "./analytics.ts";

export type ContentAnalyticsEvent = {
  id: string;
  event_type: AnalyticsEventType;
  content_id: string | null;
  referral_link_id: string | null;
  value: number | string;
  created_at: string;
};

export type ContentReferralMetrics = {
  content_id: string;
  referral_link_id: string;
  clicks: number;
  conversions: number;
  revenue: number;
  last_click_at: string | null;
  last_conversion_at: string | null;
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

function normalizeTimestamp(
  value: string,
): string {
  const timestamp = new Date(value);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(`Invalid analytics timestamp: ${value}`);
  }

  return timestamp.toISOString();
}

function latestTimestamp(
  current: string | null,
  candidate: string,
): string {
  if (!current) {
    return candidate;
  }

  return Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

export function rollupContentReferralEvents(
  events: ContentAnalyticsEvent[],
): ContentReferralMetrics[] {
  const metrics = new Map<string, ContentReferralMetrics>();

  for (const event of events) {
    const contentId = requiredString(
      event.content_id,
      `Analytics event ${event.id} content id`,
    );
    const referralLinkId = requiredString(
      event.referral_link_id,
      `Analytics event ${event.id} referral link id`,
    );
    const createdAt = normalizeTimestamp(event.created_at);
    const key = `${contentId}:${referralLinkId}`;
    const current = metrics.get(key) ?? {
      content_id: contentId,
      referral_link_id: referralLinkId,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      last_click_at: null,
      last_conversion_at: null,
    };

    if (event.event_type === "referral_click") {
      current.clicks += 1;
      current.last_click_at = latestTimestamp(
        current.last_click_at,
        createdAt,
      );
    }

    if (event.event_type === "conversion") {
      current.conversions += 1;
      current.last_conversion_at = latestTimestamp(
        current.last_conversion_at,
        createdAt,
      );
    }

    if (event.event_type === "commission") {
      const value = Number(event.value);

      if (!Number.isFinite(value) || value < 0) {
        throw new Error(
          `Invalid commission value for event: ${event.id}`,
        );
      }

      current.revenue = Number(
        (current.revenue + value).toFixed(2),
      );
    }

    metrics.set(key, current);
  }

  return [...metrics.values()].sort((left, right) =>
    left.content_id.localeCompare(right.content_id) ||
    left.referral_link_id.localeCompare(right.referral_link_id)
  );
}
