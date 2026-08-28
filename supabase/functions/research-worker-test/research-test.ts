import {
  runResearch,
} from "../research-worker/research.ts";

const testJob = {
  id: "4689ec8f-745d-49d4-a8c6-b8c70a6fe46d",
  agent: "research",
  task_type: "topic_research",
  payload: {
    request_id:
      "11111111-1111-1111-1111-111111111111",
    language: "ru",
    region: "EU",
    topic_seed: "image enhancement",
    candidate: {
      title:
        "Free AI Image Enhancer, Photo Enhancer & Upscaler",
      url: "https://www.krea.ai/apps/enhance",
      opportunity_score: 0.75,
      commercial_intent: 0.8,
      content_potential: 0.65,
      referral_potential: 0.9,
      relevance: 0.68,
      evidence_source: "tavily",
    },
    recommended_action:
      "investigate_referral_program",
  },
};

const result = await runResearch(testJob);

console.log(
  JSON.stringify(
    {
      candidate_url: result.candidate_url,
      recommendation: result.recommendation,
      results_count: result.research.results_count,
      answer_present: Boolean(result.research.answer),
      first_source:
        result.research.sources[0]?.url ?? null,
    },
    null,
    2,
  ),
);