import type {
  Opportunity,
} from "./opportunity-selector.ts";

export type ScoutOpportunity = Opportunity & {
  topic_seed: string;
  recommended_action:
    | "investigate_referral_program"
    | "investigate_affiliate_program"
    | "content_candidate"
    | "discard";
};

function chooseAction(
  opportunity: Opportunity,
): ScoutOpportunity["recommended_action"] {
  if (
    opportunity.referral_potential >= 0.85 &&
    opportunity.commercial_intent >= 0.75
  ) {
    return "investigate_referral_program";
  }

  if (
    opportunity.referral_potential >= 0.75 &&
    opportunity.commercial_intent >= 0.65
  ) {
    return "investigate_affiliate_program";
  }

  if (opportunity.content_potential >= 0.75) {
    return "content_candidate";
  }

  return "discard";
}

export function buildScoutOpportunities(
  opportunities: Opportunity[],
  topicSeed: string,
): ScoutOpportunity[] {
  return opportunities.map((opportunity) => ({
    ...opportunity,
    topic_seed: topicSeed,
    recommended_action: chooseAction(opportunity),
  }));
}