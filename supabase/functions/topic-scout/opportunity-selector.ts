import type {
  ScoredResearchResult,
} from "./research-scoring.ts";

export type Opportunity = {
  title: string;
  url: string;
  opportunity_score: number;
  commercial_intent: number;
  content_potential: number;
  referral_potential: number;
  relevance: number;
  evidence_source: string;
};

function round(value: number): number {
  return Number(value.toFixed(2));
}

export function selectTopOpportunities(
  results: ScoredResearchResult[],
  limit = 3,
): Opportunity[] {
  const candidates = results
    .filter((item) => item.final_score >= 0.55)
    .map((item) => ({
      title: item.title,
      url: item.url ?? item.normalized_url,
      opportunity_score: item.final_score,
      commercial_intent: item.commercial_intent,
      content_potential: item.content_potential,
      referral_potential: item.referral_potential,
      relevance: item.relevance,
      evidence_source: item.source,
    }));

  const selected: Opportunity[] = [];
  const seenDomains = new Set<string>();

  for (const candidate of candidates) {
    let domain = "";

    try {
      domain = new URL(candidate.url).hostname
        .replace(/^www\./, "")
        .toLowerCase();
    } catch {
      domain = candidate.url.toLowerCase();
    }

    if (seenDomains.has(domain)) {
      continue;
    }

    seenDomains.add(domain);

    selected.push({
      ...candidate,
      opportunity_score: round(candidate.opportunity_score),
      commercial_intent: round(candidate.commercial_intent),
      content_potential: round(candidate.content_potential),
      referral_potential: round(candidate.referral_potential),
      relevance: round(candidate.relevance),
    });

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}