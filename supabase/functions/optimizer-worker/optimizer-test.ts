import {
  evaluateOptimization,
  rankOptimizationDecisions,
} from "./optimizer.ts";
import type {
  OptimizationSnapshot,
} from "./optimizer.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const snapshot: OptimizationSnapshot = {
  content_id: "00000000-0000-4000-8000-000000002000",
  referral_link_id:
    "00000000-0000-4000-8000-000000002001",
  content_status: "published",
  referral_link_status: "active",
  clicks: 100,
  conversions: 5,
  revenue: 25,
};

Deno.test("collects more data below the click threshold", () => {
  const decision = evaluateOptimization({
    ...snapshot,
    clicks: 19,
    conversions: 0,
    revenue: 0,
  });

  assert(
    decision.action === "collect_more_data",
    "Expected more data to be collected",
  );
});

Deno.test("improves qualified content without conversions", () => {
  const decision = evaluateOptimization({
    ...snapshot,
    clicks: 20,
    conversions: 0,
    revenue: 0,
  });

  assert(
    decision.action === "improve_content",
    "Expected an improvement decision",
  );
  assert(decision.priority === 80, "Priority mismatch");
});

Deno.test("scales a measured winner", () => {
  const decision = evaluateOptimization(snapshot);

  assert(
    decision.action === "scale_content",
    "Expected a scaling decision",
  );
  assert(
    decision.conversion_rate === 0.05,
    "Conversion rate mismatch",
  );
});

Deno.test("monitors valid performance below the winner threshold", () => {
  const decision = evaluateOptimization({
    ...snapshot,
    conversions: 4,
  });

  assert(
    decision.action === "monitor",
    "Expected a monitoring decision",
  );
});

Deno.test("skips ineligible content and links", () => {
  const decision = evaluateOptimization({
    ...snapshot,
    referral_link_status: "paused",
  });

  assert(decision.action === "skip", "Expected a skip decision");
  assert(decision.priority === 0, "Skip priority mismatch");
});

Deno.test("rejects conversions that exceed clicks", () => {
  let error: Error | null = null;

  try {
    evaluateOptimization({
      ...snapshot,
      clicks: 2,
      conversions: 3,
    });
  } catch (caught) {
    error = caught as Error;
  }

  assert(error, "Expected invalid metrics to be rejected");
  assert(
    error.message.includes("cannot exceed clicks"),
    "Unexpected validation error",
  );
});

Deno.test("rejects negative or fractional counters", () => {
  for (const clicks of [-1, 2.5]) {
    let rejected = false;

    try {
      evaluateOptimization({ ...snapshot, clicks });
    } catch {
      rejected = true;
    }

    assert(rejected, `Expected clicks=${clicks} to be rejected`);
  }
});

Deno.test("ranks decisions deterministically", () => {
  const decisions = rankOptimizationDecisions([
    {
      ...snapshot,
      content_id:
        "00000000-0000-4000-8000-000000002010",
      clicks: 10,
      conversions: 0,
      revenue: 0,
    },
    {
      ...snapshot,
      content_id:
        "00000000-0000-4000-8000-000000002011",
      conversions: 0,
      revenue: 0,
    },
    snapshot,
  ]);

  assert(
    decisions.map((decision) => decision.action).join("|") ===
      "improve_content|scale_content|collect_more_data",
    "Decision order mismatch",
  );
});
