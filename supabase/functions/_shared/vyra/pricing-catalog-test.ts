import {
  estimateOpenAIUsageUsd,
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