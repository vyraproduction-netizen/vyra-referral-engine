import {
  prepareResearchJobs,
} from "./job-writer.ts";

import {
  buildResearchJob,
} from "./research-job.ts";

Deno.test(
  "prepareResearchJobs removes duplicates and creates stable keys",
  () => {
    const requestId =
      "11111111-1111-1111-1111-111111111111";

    const airbrushJob = buildResearchJob(
      {
        title: "Airbrush Image Enhancer",
        url:
          "https://airbrush.com/image-enhancer",
        opportunity_score: 0.78,
        commercial_intent: 0.8,
        content_potential: 0.8,
        referral_potential: 0.9,
        relevance: 0.68,
        evidence_source: "test",
        topic_seed: "image enhancement",
        recommended_action:
          "investigate_referral_program",
      },
      requestId,
      "ru",
      "EU",
    );

    const picsartJob = buildResearchJob(
      {
        title: "Picsart AI Photo Enhancer",
        url:
          "https://picsart.com/ai-image-enhancer",
        opportunity_score: 0.78,
        commercial_intent: 0.8,
        content_potential: 0.8,
        referral_potential: 0.9,
        relevance: 0.68,
        evidence_source: "test",
        topic_seed: "image enhancement",
        recommended_action:
          "investigate_referral_program",
      },
      requestId,
      "ru",
      "EU",
    );

    const picwishJob = buildResearchJob(
      {
        title: "PicWish",
        url:
          "https://picwish.com/photo-enhancer",
        opportunity_score: 0.75,
        commercial_intent: 0.8,
        content_potential: 0.8,
        referral_potential: 0.75,
        relevance: 0.68,
        evidence_source: "test",
        topic_seed: "image enhancement",
        recommended_action:
          "investigate_affiliate_program",
      },
      requestId,
      "ru",
      "EU",
    );

    const input = [
      airbrushJob,
      airbrushJob,
      picsartJob,
      picwishJob,
    ];

    const result = prepareResearchJobs(input);

    if (result.length !== 3) {
      throw new Error(
        `Expected 3 unique jobs, received ${result.length}`,
      );
    }

    const keys = result.map(
      (item) => item.dedupe_key,
    );

    if (new Set(keys).size !== keys.length) {
      throw new Error(
        "Duplicate dedupe keys remained in result",
      );
    }

    const expectedAirbrushKey =
      `${requestId}:topic_research:https://airbrush.com/image-enhancer`;

    if (!keys.includes(expectedAirbrushKey)) {
      throw new Error(
        `Expected dedupe key not found: ${expectedAirbrushKey}`,
      );
    }

    if (input.length !== 4) {
      throw new Error(
        "Input array was unexpectedly modified",
      );
    }
  },
);