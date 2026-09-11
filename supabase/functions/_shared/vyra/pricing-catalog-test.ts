import {
  estimateOpenAIUsageUsd,
  findVerifiedOpenAIPriceQuote,
  hasRecordedPrice,
  type VerifiedOpenAIPriceQuote,
} from "./pricing-catalog.ts";

const quote: VerifiedOpenAIPriceQuote = {
  provider: "openai",
  model: "test-model",
  currency: "USD",
  input_usd_micros_per_million_tokens: 300_000,
  output_usd_micros_per_million_tokens: 1_700_000,
  pricing_version: "test-2026-09-10",
  source_url: "https://example.invalid/openai-pricing",
  verified_at: "2026-09-10T00:00:00.000Z",
};

Deno.test("VYRA OpenAI quote pins the active snapshot and standard rates", () => {
  const active = findVerifiedOpenAIPriceQuote("gpt-5-mini-2025-08-07");
  if (!active || active.input_usd_micros_per_million_tokens !== 250000 ||
    active.output_usd_micros_per_million_tokens !== 2000000 ||
    !active.source_url.startsWith("https://developers.openai.com/")) {
    throw new Error("Active OpenAI price quote was missing or incorrect");
  }
  if (findVerifiedOpenAIPriceQuote("unknown-model") !== undefined) {
    throw new Error("Unknown OpenAI model unexpectedly received a quote");
  }
});

Deno.test("OpenAI pricing estimate uses an explicit verified quote", () => {
  const estimate = estimateOpenAIUsageUsd("test-model", {
    input_tokens: 1_000,
    output_tokens: 2_000,
  }, quote);

  if (!estimate || estimate.currency !== "USD" ||
    estimate.input_usd_micros !== 300 ||
    estimate.output_usd_micros !== 3_400 ||
    estimate.total_usd_micros !== 3_700 ||
    estimate.pricing_version !== quote.pricing_version) {
    throw new Error("OpenAI USD estimate was incorrect");
  }
});

Deno.test("OpenAI pricing estimate refuses unknown models and incomplete usage", () => {
  if (estimateOpenAIUsageUsd("other-model", {
    input_tokens: 1,
    output_tokens: 1,
  }, quote) !== null) {
    throw new Error("Unknown model received a price estimate");
  }

  if (estimateOpenAIUsageUsd("test-model", { input_tokens: 1 }, quote) !== null) {
    throw new Error("Incomplete token usage received a price estimate");
  }
});

Deno.test("Cost status pricing requires at least one EUR or USD observation", () => {
  if (hasRecordedPrice(0, 0) || !hasRecordedPrice(1, 0) ||
    !hasRecordedPrice(0, 1) || hasRecordedPrice(-1, 0)) {
    throw new Error("Cost price availability was calculated incorrectly");
  }
});
