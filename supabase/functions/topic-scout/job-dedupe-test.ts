import {
  filterNewResearchJobs,
} from "./job-dedupe.ts";

import {
  buildResearchJob,
} from "./research-job.ts";

Deno.test(
  "filterNewResearchJobs removes an existing job",
  async () => {
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
          "investigate_referral_program",
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

    let checkedKey: string | null = null;

    const result = await filterNewResearchJobs(
      jobs,
      async (dedupeKey) => {
        checkedKey = dedupeKey;
        return dedupeKey === duplicateKey;
      },
    );

    if (checkedKey !== duplicateKey) {
      throw new Error(
        `Unexpected dedupe key: ${checkedKey}`,
      );
    }

    if (result.length !== 0) {
      throw new Error(
        `Expected 0 new jobs, received ${result.length}`,
      );
    }
  },
);