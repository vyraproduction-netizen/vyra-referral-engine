import {
  contentReferralMetricsFromStoredRows,
} from "./stored-content-metrics.ts";
import type {
  StoredContentReferralMetricRow,
} from "./stored-content-metrics.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function row(
  contentId = "00000000-0000-4000-8000-000000009001",
  referralLinkId = "00000000-0000-4000-8000-000000009002",
): StoredContentReferralMetricRow {
  return {
    content_id: contentId,
    referral_link_id: referralLinkId,
    clicks: 10,
    conversions: 2,
    revenue: 12.345,
    last_click_at: "2026-09-05T12:00:00+00:00",
    last_conversion_at: "2026-09-05T12:01:00+00:00",
  };
}

function rejects(
  candidate: StoredContentReferralMetricRow[],
  expectedMessage: string,
): void {
  let actualMessage = "";

  try {
    contentReferralMetricsFromStoredRows(candidate);
  } catch (error) {
    actualMessage = error instanceof Error ? error.message : String(error);
  }

  assert(
    actualMessage.includes(expectedMessage),
    `Expected rejection containing: ${expectedMessage}`,
  );
}

Deno.test("maps stored content metrics deterministically", () => {
  const later = row(
    "00000000-0000-4000-8000-000000009011",
    "00000000-0000-4000-8000-000000009012",
  );
  const earlier = row();
  const metrics = contentReferralMetricsFromStoredRows([later, earlier]);

  assert(metrics.length === 2, "Expected two metrics");
  assert(metrics[0].content_id === earlier.content_id, "Metrics not sorted");
  assert(metrics[0].clicks === 10, "Clicks changed");
  assert(metrics[0].conversions === 2, "Conversions changed");
  assert(metrics[0].revenue === 12.35, "Revenue was not normalized");
  assert(
    metrics[0].last_click_at === "2026-09-05T12:00:00.000Z",
    "Last click timestamp was not normalized",
  );
});

Deno.test("accepts an empty stored metric snapshot", () => {
  const metrics = contentReferralMetricsFromStoredRows([]);
  assert(metrics.length === 0, "Empty snapshot changed");
});

Deno.test("preserves null metric timestamps", () => {
  const candidate = {
    ...row(),
    last_click_at: null,
    last_conversion_at: null,
  };
  const metrics = contentReferralMetricsFromStoredRows([candidate]);

  assert(metrics[0].last_click_at === null, "Null click timestamp changed");
  assert(
    metrics[0].last_conversion_at === null,
    "Null conversion timestamp changed",
  );
});

Deno.test("rejects duplicate stored metric pairs", () => {
  const candidate = row();
  rejects([candidate, candidate], "Duplicate stored content metric");
});

Deno.test("rejects missing stored metric identifiers", () => {
  rejects([{ ...row(), content_id: " " }], "content id is required");
  rejects(
    [{ ...row(), referral_link_id: " " }],
    "referral link id is required",
  );
});

Deno.test("rejects invalid stored metric counters", () => {
  rejects([{ ...row(), clicks: -1 }], "Invalid stored content metric counters");
  rejects(
    [{ ...row(), conversions: 11 }],
    "Invalid stored content metric counters",
  );
  rejects(
    [{ ...row(), clicks: 1.5 }],
    "Invalid stored content metric counters",
  );
});

Deno.test("rejects invalid stored metric revenue", () => {
  rejects([{ ...row(), revenue: -1 }], "Invalid stored content metric revenue");
  rejects(
    [{ ...row(), revenue: Number.NaN }],
    "Invalid stored content metric revenue",
  );
});

Deno.test("rejects invalid stored metric timestamps", () => {
  rejects(
    [{ ...row(), last_click_at: "not-a-date" }],
    "last click at is invalid",
  );
  rejects(
    [{ ...row(), last_conversion_at: "not-a-date" }],
    "last conversion at is invalid",
  );
});
