import {
  filterNewResearchJobs,
} from "./job-dedupe.ts";

import {
  buildResearchJob,
} from "./research-job.ts";

const duplicateKey =
  "22222222-2222-2222-2222-222222222222:topic_research:https://www.krea.ai/apps/enhance";

const researchJob = buildResearchJob(
  {
    title: "Krea AI Enhance",
    url: "https://www.krea.ai/apps/enhance",
    opportunity_score: 0.75,
    commercial_intent: 0.8,
    content_potential: 0.8,
    referral_potential: 0.75,
    relevance: 0.68,
    evidence_source: "test",
    topic_seed: "image enhancement",
    recommended_action:
      "investigate_referral_program" as const,
  },
  "22222222-2222-2222-2222-222222222222",
  "ru",
  "EU",
);

const jobs = [
  {
    job: researchJob,
    dedupe_key: duplicateKey,
  },
];

const result = await filterNewResearchJobs(
  jobs,
  async (dedupeKey) => {
    console.log("Checker received:", dedupeKey);
    return dedupeKey === duplicateKey;
  },
);

console.log(
  JSON.stringify(
    {
      input_jobs: jobs.length,
      new_jobs: result.length,
      expected_new_jobs: 0,
    },
    null,
    2,
  ),
);