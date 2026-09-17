import { rollupContentReferralEvents } from "./content-referral-metrics.ts";
import type { ContentAnalyticsEvent } from "./content-referral-metrics.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function event(
  id: string,
  contentId: string,
  referralLinkId: string,
  eventType: ContentAnalyticsEvent["event_type"],
  value: number | string = 0,
  createdAt = "2026-09-05T09:00:00Z",
): ContentAnalyticsEvent {
  return {
    id,
    content_id: contentId,
    referral_link_id: referralLinkId,
    event_type: eventType,
    value,
    created_at: createdAt,
  };
}

const sourceContentId = "00000000-0000-4000-8000-000000008800";
const expandedContentId = "00000000-0000-4000-8000-000000008801";
const sharedLinkId = "00000000-0000-4000-8000-000000008802";

Deno.test("isolates metrics by content on a shared link", () => {
  const metrics = rollupContentReferralEvents([
    event("1", sourceContentId, sharedLinkId, "referral_click"),
    event("2", sourceContentId, sharedLinkId, "conversion"),
    event("3", sourceContentId, sharedLinkId, "commission", 12.5),
    event("4", expandedContentId, sharedLinkId, "referral_click"),
  ]);

  assert(metrics.length === 2, "Expected two content metrics");
  assert(metrics[0].content_id === sourceContentId, "Source order changed");
  assert(metrics[0].clicks === 1, "Source clicks mismatch");
  assert(metrics[0].conversions === 1, "Source conversions mismatch");
  assert(metrics[0].revenue === 12.5, "Source revenue mismatch");
  assert(metrics[1].content_id === expandedContentId, "Expansion missing");
  assert(metrics[1].clicks === 1, "Expansion clicks mismatch");
  assert(metrics[1].conversions === 0, "Expansion inherited conversions");
  assert(metrics[1].revenue === 0, "Expansion inherited revenue");
});

Deno.test("isolates metrics by referral link for one content", () => {
  const secondLinkId = "00000000-0000-4000-8000-000000008803";
  const metrics = rollupContentReferralEvents([
    event("1", sourceContentId, sharedLinkId, "referral_click"),
    event("2", sourceContentId, secondLinkId, "referral_click"),
  ]);

  assert(metrics.length === 2, "Expected two link metrics");
  assert(
    metrics[0].referral_link_id === sharedLinkId,
    "Shared link order changed",
  );
  assert(
    metrics[1].referral_link_id === secondLinkId,
    "Second link missing",
  );
});

Deno.test("preserves latest content timestamps", () => {
  const metrics = rollupContentReferralEvents([
    event(
      "1",
      sourceContentId,
      sharedLinkId,
      "referral_click",
      0,
      "2026-09-05T09:00:00Z",
    ),
    event(
      "2",
      sourceContentId,
      sharedLinkId,
      "referral_click",
      0,
      "2026-09-05T10:00:00Z",
    ),
  ]);

  assert(
    metrics[0].last_click_at === "2026-09-05T10:00:00.000Z",
    "Latest click timestamp mismatch",
  );
});

Deno.test("rounds accumulated content revenue", () => {
  const metrics = rollupContentReferralEvents([
    event("1", sourceContentId, sharedLinkId, "commission", "1.005"),
    event("2", sourceContentId, sharedLinkId, "commission", "2.005"),
  ]);

  assert(metrics[0].revenue === 3, "Revenue rounding mismatch");
});

for (
  const [name, invalidEvent] of [
    [
      "missing content id",
      event("1", "", sharedLinkId, "referral_click"),
    ],
    [
      "missing referral link id",
      event("1", sourceContentId, "", "referral_click"),
    ],
    [
      "invalid timestamp",
      event("1", sourceContentId, sharedLinkId, "referral_click", 0, "bad"),
    ],
    [
      "negative commission",
      event("1", sourceContentId, sharedLinkId, "commission", -1),
    ],
  ] as const
) {
  Deno.test(`rejects ${name}`, () => {
    let rejected = false;

    try {
      rollupContentReferralEvents([invalidEvent]);
    } catch {
      rejected = true;
    }

    assert(rejected, `Accepted ${name}`);
  });
}
