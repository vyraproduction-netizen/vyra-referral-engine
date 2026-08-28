import type {
  ScoutOpportunity,
} from "./scout-opportunity.ts";

export type ResearchJob = {
  agent: "research";
  task_type: "topic_research";
  status: "queued";
  priority: number;
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
    recommended_action:
      | "investigate_referral_program"
      | "investigate_affiliate_program"
      | "content_candidate"
      | "discard";
  };
  max_attempts: number;
};

export function buildResearchJob(
  opportunity: ScoutOpportunity,
  requestId: string,
  language: string,
  region: string,
): ResearchJob {
  return {
    agent: "research",
    task_type: "topic_research",
    status: "queued",
    priority: Math.round(
      opportunity.opportunity_score * 100,
    ),
    payload: {
      request_id: requestId,
      language,
      region,
      topic_seed: opportunity.topic_seed,
      candidate: {
        title: opportunity.title,
        url: opportunity.url,
        opportunity_score: opportunity.opportunity_score,
        commercial_intent: opportunity.commercial_intent,
        content_potential: opportunity.content_potential,
        referral_potential: opportunity.referral_potential,
        relevance: opportunity.relevance,
        evidence_source: opportunity.evidence_source,
      },
      recommended_action:
        opportunity.recommended_action,
    },
    max_attempts: 3,
  };
}