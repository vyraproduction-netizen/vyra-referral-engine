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