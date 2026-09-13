export type AnalyticsEventType =
  | "view"
  | "click"
  | "referral_click"
  | "conversion"
  | "commission";

export type AnalyticsEvent = {
  id: string;
  event_type: AnalyticsEventType;
  referral_link_id: string | null;
  value: number | string;
  created_at: string;
};

export type ReferralMetrics = {
  referral_link_id: string;
  clicks: number;
  conversions: number;
  revenue: number;
  last_click_at: string | null;
  last_conversion_at: string | null;
};

function normalizeTimestamp(
  value: string,
): string {
  const timestamp = new Date(value);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(
      `Invalid analytics timestamp: ${value}`,
    );
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

  return Date.parse(candidate) > Date.parse(current)
    ? candidate
    : current;
}

export function rollupReferralEvents(
  events: AnalyticsEvent[],
  referralLinkIds: string[] = [],
): ReferralMetrics[] {
  const metrics = new Map<string, ReferralMetrics>();

  for (const referralLinkId of referralLinkIds) {
    metrics.set(referralLinkId, {
      referral_link_id: referralLinkId,
      clicks: 0,
      conversions: 0,
      revenue: 0,
      last_click_at: null,
      last_conversion_at: null,
    });
  }

  for (const event of events) {
    if (!event.referral_link_id) {
      continue;
    }

    const createdAt = normalizeTimestamp(
      event.created_at,
    );

    const current = metrics.get(
      event.referral_link_id,
    ) ?? {
      referral_link_id: event.referral_link_id,
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

      if (!Number.isFinite(value)) {
        throw new Error(
          `Invalid commission value for event: ${event.id}`,
        );
      }

      current.revenue = Number(
        (current.revenue + value).toFixed(2),
      );
    }

    metrics.set(event.referral_link_id, current);
  }

  return [...metrics.values()].sort((left, right) =>
    left.referral_link_id.localeCompare(
      right.referral_link_id,
    )
  );
}
