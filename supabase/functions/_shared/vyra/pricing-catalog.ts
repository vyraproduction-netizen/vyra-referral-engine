export type TokenUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

export type VerifiedOpenAIPriceQuote = {
  provider: "openai";
  model: string;
  currency: "USD";
  input_usd_micros_per_million_tokens: number;
  output_usd_micros_per_million_tokens: number;
  pricing_version: string;
  source_url: string;
  verified_at: string;
};

export type OpenAIEstimate = {
  currency: "USD";
  input_usd_micros: number;
  output_usd_micros: number;
  total_usd_micros: number;
  pricing_version: string;
  source_url: string;
};

const tokensPerMillion = 1_000_000;

function isSafeNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function estimateMicros(
  tokens: number | undefined,
  microsPerMillionTokens: number,
): number | null {
  if (
    tokens === undefined ||
    !isSafeNonNegativeInteger(tokens) ||
    !isSafeNonNegativeInteger(microsPerMillionTokens)
  ) {
    return null;
  }

  const value = Math.round((tokens * microsPerMillionTokens) / tokensPerMillion);
  return Number.isSafeInteger(value) ? value : null;
}

export function estimateOpenAIUsageUsd(
  activeModel: string,
  usage: TokenUsage | undefined,
  quote: VerifiedOpenAIPriceQuote | undefined,
): OpenAIEstimate | null {
  if (!usage || !quote || quote.model !== activeModel || !quote.source_url.trim() ||
    !quote.pricing_version.trim() || !quote.verified_at.trim()) {
    return null;
  }

  const inputUsdMicros = estimateMicros(
    usage.input_tokens,
    quote.input_usd_micros_per_million_tokens,
  );
  const outputUsdMicros = estimateMicros(
    usage.output_tokens,
    quote.output_usd_micros_per_million_tokens,
  );

  if (inputUsdMicros === null || outputUsdMicros === null) {
    return null;
  }

  const totalUsdMicros = inputUsdMicros + outputUsdMicros;
  if (!Number.isSafeInteger(totalUsdMicros)) {
    return null;
  }

  return {
    currency: "USD",
    input_usd_micros: inputUsdMicros,
    output_usd_micros: outputUsdMicros,
    total_usd_micros: totalUsdMicros,
    pricing_version: quote.pricing_version,
    source_url: quote.source_url,
  };
}

const verifiedOpenAIQuotes: readonly VerifiedOpenAIPriceQuote[] = [
  {
    provider: "openai",
    model: "gpt-5-mini-2025-08-07",
    currency: "USD",
    input_usd_micros_per_million_tokens: 250000,
    output_usd_micros_per_million_tokens: 2000000,
    pricing_version: "openai-gpt-5-mini-standard-2026-09-10",
    source_url: "https://developers.openai.com/api/docs/models/gpt-5-mini",
    verified_at: "2026-09-10T00:00:00.000Z",
  },
];

export function findVerifiedOpenAIPriceQuote(
  model: string,
): VerifiedOpenAIPriceQuote | undefined {
  return verifiedOpenAIQuotes.find((quote) => quote.model === model);
}

export function hasRecordedPrice(
  eurPricedObservations: number,
  usdPricedObservations: number,
): boolean {
  return Number.isSafeInteger(eurPricedObservations) &&
      Number.isSafeInteger(usdPricedObservations) &&
      eurPricedObservations >= 0 &&
      usdPricedObservations >= 0 &&
      (eurPricedObservations > 0 || usdPricedObservations > 0);
}
