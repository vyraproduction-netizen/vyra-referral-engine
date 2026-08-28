import { prepareResearchJobs } from "./job-writer.ts";

const airbrushJob = {
  agent: "research" as const,
  task_type: "topic_research" as const,
  status: "queued" as const,
  priority: 78,
  payload: {
    request_id: "11111111-1111-1111-1111-111111111111",
    language: "ru",
    region: "EU",
    topic_seed: "image enhancement",
    candidate: {
      title: "Upscale Image Online | AI Image Enhancer",
      url: "https://airbrush.com/image-enhancer",
      opportunity_score: 0.78,
      commercial_intent: 0.8,
      content_potential: 0.8,
      referral_potential: 0.9,
      relevance: 0.68,
      evidence_source: "tavily",
    },
    recommended_action: "investigate_referral_program" as const,
  },
  max_attempts: 3,
};

const picsartJob = {
  agent: "research" as const,
  task_type: "topic_research" as const,
  status: "queued" as const,
  priority: 78,
  payload: {
    request_id: "11111111-1111-1111-1111-111111111111",
    language: "ru",
    region: "EU",
    topic_seed: "image enhancement",
    candidate: {
      title: "AI Photo Enhancer",
      url: "https://picsart.com/ai-image-enhancer",
      opportunity_score: 0.78,
      commercial_intent: 0.8,
      content_potential: 0.8,
      referral_potential: 0.9,
      relevance: 0.68,
      evidence_source: "tavily",
    },
    recommended_action: "investigate_referral_program" as const,
  },
  max_attempts: 3,
};

const picwishJob = {
  agent: "research" as const,
  task_type: "topic_research" as const,
  status: "queued" as const,
  priority: 75,
  payload: {
    request_id: "11111111-1111-1111-1111-111111111111",
    language: "ru",
    region: "EU",
    topic_seed: "image enhancement",
    candidate: {
      title: "PicWish",
      url: "https://picwish.com/photo-enhancer",
      opportunity_score: 0.75,
      commercial_intent: 0.8,
      content_potential: 0.8,
      referral_potential: 0.75,
      relevance: 0.68,
      evidence_source: "tavily",
    },
    recommended_action: "investigate_affiliate_program" as const,
  },
  max_attempts: 3,
};

const jobs = [
  airbrushJob,
  airbrushJob,
  picsartJob,
  picwishJob,
];

const result = prepareResearchJobs(jobs);

console.log(
  JSON.stringify(
    {
      input_count: jobs.length,
      output_count: result.length,
      duplicate_removed: jobs.length - result.length,
      results: result,
    },
    null,
    2,
  ),
);