import {
  buildResearchJob,
} from "./research-job.ts";

const testOpportunity = {
  title: "Upscale Image Online | AI Image Enhancer",
  url: "https://airbrush.com/image-enhancer",
  opportunity_score: 0.78,
  commercial_intent: 0.80,
  content_potential: 0.80,
  referral_potential: 0.90,
  relevance: 0.68,
  evidence_source: "tavily",
  topic_seed: "image enhancement",
  recommended_action: "investigate_referral_program" as const,
};

const job = buildResearchJob(
  testOpportunity,
  "11111111-1111-1111-1111-111111111111",
  "ru",
  "EU",
);

console.log(
  JSON.stringify(job, null, 2),
);