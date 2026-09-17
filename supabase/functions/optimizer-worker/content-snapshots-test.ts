import type {
  ContentReferralMetrics,
} from "../analytics-worker/content-referral-metrics.ts";
import { buildContentOptimizationSnapshots } from "./content-snapshots.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const sourceContentId = "00000000-0000-4000-8000-000000008900";
const expandedContentId = "00000000-0000-4000-8000-000000008901";
const sharedLinkId = "00000000-0000-4000-8000-000000008902";

const contents = [
  {
    id: sourceContentId,
    status: "published",
    referral_link_id: sharedLinkId,
  },
  {
    id: expandedContentId,
    status: "published",
    referral_link_id: sharedLinkId,
  },
];

const referrals = [{ id: sharedLinkId, status: "active" }];

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
    last_click_at: null,
    last_conversion_at: null,
  };
}

Deno.test("isolates Optimizer snapshots on a shared link", () => {
  const snapshots = buildContentOptimizationSnapshots(
    contents,
    referrals,
    [
      metric(sourceContentId, 100, 5, 25),
      metric(expandedContentId, 20, 0, 0),
    ],
  );

  assert(snapshots.length === 2, "Expected two snapshots");
  assert(snapshots[0].content_id === sourceContentId, "Source order changed");
  assert(snapshots[0].clicks === 100, "Source clicks mismatch");
  assert(snapshots[0].conversions === 5, "Source conversions mismatch");
  assert(snapshots[0].revenue === 25, "Source revenue mismatch");
  assert(snapshots[1].content_id === expandedContentId, "Expansion missing");
  assert(snapshots[1].clicks === 20, "Expansion clicks mismatch");
  assert(snapshots[1].conversions === 0, "Expansion inherited conversions");
  assert(snapshots[1].revenue === 0, "Expansion inherited revenue");
});

Deno.test("uses zero metrics for content without events", () => {
  const snapshots = buildContentOptimizationSnapshots(
    [contents[0]],
    referrals,
    [],
  );

  assert(snapshots[0].clicks === 0, "Missing clicks were not zero");
  assert(snapshots[0].conversions === 0, "Missing conversions were not zero");
  assert(snapshots[0].revenue === 0, "Missing revenue was not zero");
});

Deno.test("preserves content and referral statuses", () => {
  const snapshots = buildContentOptimizationSnapshots(
    [{ ...contents[0], status: "draft" }],
    [{ ...referrals[0], status: "paused" }],
    [],
  );

  assert(snapshots[0].content_status === "draft", "Content status changed");
  assert(
    snapshots[0].referral_link_status === "paused",
    "Referral status changed",
  );
});

Deno.test("sorts snapshots deterministically by content id", () => {
  const snapshots = buildContentOptimizationSnapshots(
    [...contents].reverse(),
    referrals,
    [],
  );

  assert(snapshots[0].content_id === sourceContentId, "Snapshots not sorted");
});

Deno.test("rejects content without a referral link", () => {
  let rejected = false;

  try {
    buildContentOptimizationSnapshots(
      [{ ...contents[0], referral_link_id: null }],
      referrals,
      [],
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Content without a referral link was accepted");
});

Deno.test("rejects a missing referral row", () => {
  let rejected = false;

  try {
    buildContentOptimizationSnapshots([contents[0]], [], []);
  } catch {
    rejected = true;
  }

  assert(rejected, "Missing referral row was accepted");
});

Deno.test("rejects duplicate referral rows", () => {
  let rejected = false;

  try {
    buildContentOptimizationSnapshots(
      [contents[0]],
      [...referrals, ...referrals],
      [],
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Duplicate referral rows were accepted");
});

Deno.test("rejects duplicate content metrics", () => {
  let rejected = false;
  const item = metric(sourceContentId, 1, 0, 0);

  try {
    buildContentOptimizationSnapshots(
      [contents[0]],
      referrals,
      [item, item],
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Duplicate content metrics were accepted");
});
