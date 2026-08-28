import type {
  NormalizedResearchResult,
} from "./research-normalizer.ts";

export type ScoredResearchResult =
  NormalizedResearchResult & {
    relevance: number;
    commercial_intent: number;
    content_potential: number;
    referral_potential: number;
    final_score: number;
  };

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function scoreRelevance(
  item: NormalizedResearchResult,
  query: string,
): number {
  const title = item.normalized_title;
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return 0.5;
  }

  if (title.includes(normalizedQuery)) {
    return 0.95;
  }

  const queryWords = normalizedQuery
    .split(/\s+/)
    .filter(Boolean);

  const matches = queryWords.filter((word) =>
    title.includes(word)
  ).length;

  return clamp(
    0.45 + (matches / Math.max(queryWords.length, 1)) * 0.45
  );
}

function scoreCommercialIntent(
  item: NormalizedResearchResult,
): number {
  const text = `${item.normalized_title} ${item.snippet}`
    .toLowerCase();

  let score = 0.40;

  if (
    /(price|pricing|plan|plans|subscription|buy|paid|premium|pro|business)/i
      .test(text)
  ) {
    score += 0.20;
  }

  if (
    /(tool|software|platform|service|app|api)/i.test(text)
  ) {
    score += 0.15;
  }

  if (
    /(free|trial|try|online|download)/i.test(text)
  ) {
    score += 0.05;
  }

  return clamp(score);
}

function scoreContentPotential(
  item: NormalizedResearchResult,
): number {
  const text = `${item.normalized_title} ${item.snippet}`
    .toLowerCase();

  let score = 0.45;

  if (
    /(how|guide|tutorial|tips|improve|enhance|restore|upscale)/i
      .test(text)
  ) {
    score += 0.20;
  }

  if (
    /(before|after|use case|example|workflow|step)/i
      .test(text)
  ) {
    score += 0.15;
  }

  return clamp(score);
}

function scoreReferralPotential(
  item: NormalizedResearchResult,
): number {
  const text = `${item.normalized_title} ${item.snippet}`
    .toLowerCase();

  let score = 0.40;

  if (
    /(tool|software|platform|service|app|api)/i.test(text)
  ) {
    score += 0.20;
  }

  if (
    /(business|professional|commercial|ecommerce|marketing)/i
      .test(text)
  ) {
    score += 0.15;
  }

  if (
    /(premium|pro|subscription|pricing|plan)/i.test(text)
  ) {
    score += 0.15;
  }

  return clamp(score);
}

export function scoreResearch(
  results: NormalizedResearchResult[],
  query: string,
): ScoredResearchResult[] {
  return results
    .map((item) => {
      const relevance = scoreRelevance(item, query);
      const commercial_intent = scoreCommercialIntent(item);
      const content_potential = scoreContentPotential(item);
      const referral_potential = scoreReferralPotential(item);

      const final_score = Number(
        (
          relevance * 0.35 +
          commercial_intent * 0.25 +
          content_potential * 0.20 +
          referral_potential * 0.20
        ).toFixed(2)
      );

      return {
        ...item,
        relevance: Number(relevance.toFixed(2)),
        commercial_intent: Number(
          commercial_intent.toFixed(2),
        ),
        content_potential: Number(
          content_potential.toFixed(2),
        ),
        referral_potential: Number(
          referral_potential.toFixed(2),
        ),
        final_score,
      };
    })
    .sort((a, b) => b.final_score - a.final_score);
}