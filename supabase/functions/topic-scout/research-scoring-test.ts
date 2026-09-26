import {
  scoreResearch,
} from "./research-scoring.ts";
import type {
  NormalizedResearchResult,
} from "./research-normalizer.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function scoreOne(
  title: string,
  snippet: string,
) {
  const results: NormalizedResearchResult[] = [
    {
      title,
      snippet,
      url: "https://example.local/research/test",
      source: "local-mock",
      normalized_title: title.toLowerCase(),
      normalized_url: "https://example.local/research/test",
    },
  ];

  const scored = scoreResearch(
    results,
    "professional ai tools",
  );

  const result = scored[0];

  assert(result, "Expected one scored result");

  return result;
}

Deno.test(
  "referral potential requires business evidence",
  () => {
    const result = scoreOne(
      "Useful AI tool",
      "Local research result for an online tool.",
    );

    assert(
      result.referral_potential === 0.6,
      "Business bonus must not apply without business evidence",
    );
  },
);

Deno.test(
  "commercial mock candidate reaches referral thresholds",
  () => {
    const result = scoreOne(
      "Professional AI tools with pricing plans",
      "Business software subscription with a free trial.",
    );

    assert(
      result.commercial_intent === 0.8,
      "Mock candidate must have commercial intent of 0.8",
    );

    assert(
      result.referral_potential === 0.9,
      "Mock candidate must have referral potential of 0.9",
    );
  },
);