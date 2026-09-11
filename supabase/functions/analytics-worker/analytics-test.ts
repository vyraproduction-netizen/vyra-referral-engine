import {
  rollupReferralEvents,
} from "./analytics.ts";
import type {
  AnalyticsEvent,
} from "./analytics.ts";

const linkA =
  "00000000-0000-4000-8000-000000000960";
const linkB =
  "00000000-0000-4000-8000-000000000961";

function event(
  id: string,
  eventType: AnalyticsEvent["event_type"],
  referralLinkId: string | null,
  createdAt: string,
  value: number | string = 0,
): AnalyticsEvent {
  return {
    id,
    event_type: eventType,
    referral_link_id: referralLinkId,
    value,
    created_at: createdAt,
  };
}

Deno.test(
  "rollupReferralEvents calculates referral metrics",
  () => {
    const result = rollupReferralEvents([
      event(
        "click-1",
        "referral_click",
        linkA,
        "2026-08-31T07:00:00Z",
      ),
      event(
        "click-2",
        "referral_click",
        linkA,
        "2026-08-31T08:00:00Z",
      ),
      event(
        "conversion-1",
        "conversion",
        linkA,
        "2026-08-31T09:00:00Z",
      ),
      event(
        "commission-1",
        "commission",
        linkA,
        "2026-08-31T09:01:00Z",
        "12.34",
      ),
      event(
        "commission-2",
        "commission",
        linkA,
        "2026-08-31T09:02:00Z",
        7.66,
      ),
    ]);

    const metrics = result[0];

    if (
      result.length !== 1 ||
      metrics.clicks !== 2 ||
      metrics.conversions !== 1 ||
      metrics.revenue !== 20 ||
      metrics.last_click_at !==
        "2026-08-31T08:00:00.000Z" ||
      metrics.last_conversion_at !==
        "2026-08-31T09:00:00.000Z"
    ) {
      throw new Error("Unexpected referral metrics");
    }
  },
);

Deno.test(
  "rollupReferralEvents ignores non-referral traffic",
  () => {
    const result = rollupReferralEvents([
      event(
        "view-1",
        "view",
        null,
        "2026-08-31T07:00:00Z",
      ),
      event(
        "generic-click-1",
        "click",
        null,
        "2026-08-31T07:01:00Z",
      ),
    ]);

    if (result.length !== 0) {
      throw new Error(
        "Non-referral traffic created metrics",
      );
    }
  },
);

Deno.test(
  "rollupReferralEvents keeps links separate and stable",
  () => {
    const result = rollupReferralEvents([
      event(
        "link-b-click",
        "referral_click",
        linkB,
        "2026-08-31T08:00:00Z",
      ),
      event(
        "link-a-click",
        "referral_click",
        linkA,
        "2026-08-31T08:00:00Z",
      ),
    ]);

    if (
      result.length !== 2 ||
      result[0].referral_link_id !== linkA ||
      result[1].referral_link_id !== linkB
    ) {
      throw new Error("Referral metrics were not stable");
    }
  },
);

Deno.test(
  "rollupReferralEvents returns zeroes for links without events",
  () => {
    const result = rollupReferralEvents([], [linkA]);
    const metrics = result[0];

    if (
      result.length !== 1 ||
      metrics.referral_link_id !== linkA ||
      metrics.clicks !== 0 ||
      metrics.conversions !== 0 ||
      metrics.revenue !== 0 ||
      metrics.last_click_at !== null ||
      metrics.last_conversion_at !== null
    ) {
      throw new Error(
        "Empty referral metrics were not resettable",
      );
    }
  },
);

Deno.test(
  "rollupReferralEvents rejects invalid commission values",
  () => {
    let rejected = false;

    try {
      rollupReferralEvents([
        event(
          "invalid-commission",
          "commission",
          linkA,
          "2026-08-31T09:00:00Z",
          "not-a-number",
        ),
      ]);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Invalid commission value was accepted",
      );
    }
  },
);
