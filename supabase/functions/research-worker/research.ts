import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import type {
  ResearchProvider,
} from "./research-provider.ts";
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

export type ResearchJob = VyraJob & {
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

export function assertResearchJob(
  job: VyraJob,
): asserts job is ResearchJob {
  const payload = job.payload;

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error("Research job payload is required");
  }

  const candidate = payload.candidate;

  if (
    !candidate ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error("Research job candidate is required");
  }

  const candidateRecord =
    candidate as Record<string, unknown>;

  const payloadStringFields = [
    "request_id",
    "language",
    "region",
    "topic_seed",
    "recommended_action",
  ] as const;

  for (const field of payloadStringFields) {
    if (
      typeof payload[field] !== "string" ||
      payload[field].length === 0
    ) {
      throw new Error(
        `Research job payload.${field} is required`,
      );
    }
  }

  const candidateStringFields = [
    "title",
    "url",
    "evidence_source",
  ] as const;

  for (const field of candidateStringFields) {
    if (
      typeof candidateRecord[field] !== "string" ||
      candidateRecord[field].length === 0
    ) {
      throw new Error(
        `Research job candidate.${field} is required`,
      );
    }
  }

  const candidateNumberFields = [
    "opportunity_score",
    "commercial_intent",
    "content_potential",
    "referral_potential",
    "relevance",
  ] as const;

  for (const field of candidateNumberFields) {
    if (
      typeof candidateRecord[field] !== "number" ||
      !Number.isFinite(candidateRecord[field])
    ) {
      throw new Error(
        `Research job candidate.${field} must be a number`,
      );
    }
  }
}

export async function runResearch(
  job: ResearchJob,
  researchProvider: ResearchProvider = researchWithTavily,
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

  const candidate = job.payload.candidate;

  if (!candidate.url) {
    throw new Error("Candidate URL is required");
  }

  if (!candidate.title) {
    throw new Error("Candidate title is required");
  }

  const query = [
    candidate.title,
    candidate.url,
    "referral program",
    "affiliate program",
    "pricing",
  ].join(" ");

  const research = await researchProvider(query);

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
      query: research.query,
      answer: research.answer ?? null,
      results_count: research.results.length,
      sources: research.results.slice(0, 5),
    },
  };
}
