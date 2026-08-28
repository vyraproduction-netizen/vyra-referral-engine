import {
  researchWithTavily,
} from "./tavily-research.ts";

export type ResearchFinding = {
  candidate_url: string;
  candidate_title: string;
  recommendation: string;
  opportunity_score: number;
  commercial_intent: number;
  content_potential: number;
  referral_potential: number;
  relevance: number;
  evidence_source: string;
  research: {
    query: string;
    answer: string | null;
    results_count: number;
    sources: Array<{
      title: string;
      url: string;
      content: string;
      score?: number;
    }>;
  };
};

type ResearchJob = {
  id: string;
  agent: string;
  task_type: string;
  payload: {
    request_id: string;
    language: string;
    region: string;
    topic_seed: string;
    candidate: {
      title: string;
      url: string;
      opportunity_score: number;
      commercial_intent: number;
      content_potential: number;
      referral_potential: number;
      relevance: number;
      evidence_source: string;
    };
    recommended_action: string;
  };
};

export async function runResearch(
  job: ResearchJob,
): Promise<ResearchFinding> {
  if (job.agent !== "research") {
    throw new Error("Invalid agent");
  }

  if (job.task_type !== "topic_research") {
    throw new Error("Invalid task_type");
  }

  if (!job.id) {
    throw new Error("Job id is required");
  }

  const candidate = job.payload?.candidate;

  if (!candidate?.url) {
    throw new Error("Candidate URL is required");
  }

  if (!candidate?.title) {
    throw new Error("Candidate title is required");
  }

  const query = [
    candidate.title,
    candidate.url,
    "referral program",
    "affiliate program",
    "pricing",
  ].join(" ");

  const tavily = await researchWithTavily(query);

  return {
    candidate_url: candidate.url,
    candidate_title: candidate.title,
    recommendation:
      job.payload.recommended_action,
    opportunity_score:
      candidate.opportunity_score,
    commercial_intent:
      candidate.commercial_intent,
    content_potential:
      candidate.content_potential,
    referral_potential:
      candidate.referral_potential,
    relevance:
      candidate.relevance,
    evidence_source:
      candidate.evidence_source,
    research: {
      query: tavily.query,
      answer: tavily.answer ?? null,
      results_count: tavily.results.length,
      sources: tavily.results.slice(0, 5),
    },
  };
}