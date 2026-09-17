import type {
  TavilyResearchResult,
} from "./tavily-research.ts";

export function researchWithMock(
  query: string,
): Promise<TavilyResearchResult> {
  return Promise.resolve({
    query,
    answer:
      "Local deterministic research result for runtime validation.",
    results: [
      {
        title: "Diagnostic referral program evidence",
        url: "https://example.local/referral-program",
        content:
          "Mock evidence for referral, affiliate, and pricing checks.",
        score: 1,
      },
    ],
  });
}
