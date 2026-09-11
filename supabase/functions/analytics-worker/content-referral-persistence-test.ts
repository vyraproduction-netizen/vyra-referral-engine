import type {
  ContentReferralMetrics,
} from "./content-referral-metrics.ts";
import {
  buildContentReferralMetricSync,
} from "./content-referral-persistence.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const sourceContentId =
  "00000000-0000-4000-8000-000000008900";
const expandedContentId =
  "00000000-0000-4000-8000-000000008901";
const staleContentId =
  "00000000-0000-4000-8000-000000008902";
const sharedLinkId =
  "00000000-0000-4000-8000-000000008903";
const updatedAt = "2026-09-05T13:45:00Z";

function metric(
  contentId: string,
  clicks: number,
  conversions: number,
  revenue: number,
): ContentReferralMetrics {
  return {
    content_id: contentId,
    referral_link_id: sharedLinkId,
    clicks,
    conversions,
    revenue,
    last_click_at: "2026-09-05T13:00:00Z",
    last_conversion_at: conversions > 0
      ? "2026-09-05T13:30:00Z"
      : null,
  };
}

Deno.test("builds isolated upserts for content sharing one link", () => {
  const result = buildContentReferralMetricSync([], [
    metric(sourceContentId, 100, 5, 25),
    metric(expandedContentId, 20, 0, 0),
  ], updatedAt);

  assert(result.upserts.length === 2, "Expected two upserts");
  assert(result.upserts[0].clicks === 100, "Source clicks changed");
  assert(result.upserts[1].clicks === 20, "Expansion clicks changed");
  assert(result.deletes.length === 0, "Unexpected deletes");
});

Deno.test("deletes stored pairs absent from the full rollup", () => {
  const result = buildContentReferralMetricSync([
    { content_id: staleContentId, referral_link_id: sharedLinkId },
  ], [metric(sourceContentId, 1, 0, 0)], updatedAt);

  assert(result.deletes.length === 1, "Stale pair was not deleted");
  assert(
    result.deletes[0].content_id === staleContentId,
    "Wrong pair was deleted",
  );
});

Deno.test("keeps stored pairs present in the full rollup", () => {
  const result = buildContentReferralMetricSync([
    { content_id: sourceContentId, referral_link_id: sharedLinkId },
  ], [metric(sourceContentId, 1, 0, 0)], updatedAt);

  assert(result.deletes.length === 0, "Current pair was deleted");
});

Deno.test("normalizes timestamps and rounds revenue", () => {
  const result = buildContentReferralMetricSync(
    [],
    [metric(sourceContentId, 1, 1, 12.345)],
    updatedAt,
  );

  assert(result.upserts[0].revenue === 12.35, "Revenue was not rounded");
  assert(
    result.upserts[0].updated_at === "2026-09-05T13:45:00.000Z",
    "Updated timestamp was not normalized",
  );
});

Deno.test("sorts upserts and deletes deterministically", () => {
  const result = buildContentReferralMetricSync([
    { content_id: staleContentId, referral_link_id: sharedLinkId },
    { content_id: expandedContentId, referral_link_id: sharedLinkId },
  ], [
    metric(expandedContentId, 1, 0, 0),
    metric(sourceContentId, 1, 0, 0),
  ], updatedAt);

  assert(
    result.upserts[0].content_id === sourceContentId,
    "Upserts were not sorted",
  );
  assert(
    result.deletes[0].content_id === staleContentId,
    "Delete order changed",
  );
});

Deno.test("rejects duplicate stored pairs", () => {
  const stored = {
    content_id: sourceContentId,
    referral_link_id: sharedLinkId,
  };
  let rejected = false;

  try {
    buildContentReferralMetricSync([stored, stored], [], updatedAt);
  } catch {
    rejected = true;
  }

  assert(rejected, "Duplicate stored pair was accepted");
});

Deno.test("rejects duplicate current metrics", () => {
  const item = metric(sourceContentId, 1, 0, 0);
  let rejected = false;

  try {
    buildContentReferralMetricSync([], [item, item], updatedAt);
  } catch {
    rejected = true;
  }

  assert(rejected, "Duplicate current metric was accepted");
});

for (
  const [name, invalidMetric] of [
    ["negative clicks", metric(sourceContentId, -1, 0, 0)],
    ["excess conversions", metric(sourceContentId, 1, 2, 0)],
    ["negative revenue", metric(sourceContentId, 1, 0, -1)],
  ] as const
) {
  Deno.test(`rejects ${name}`, () => {
    let rejected = false;

    try {
      buildContentReferralMetricSync([], [invalidMetric], updatedAt);
    } catch {
      rejected = true;
    }

    assert(rejected, `Accepted ${name}`);
  });
}
