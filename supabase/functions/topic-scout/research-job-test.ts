import {
  buildResearchJob,
} from "./research-job.ts";

Deno.test(
  "buildResearchJob creates a valid research contract",
  () => {
    const job = buildResearchJob(
      {
        title:
          "Upscale Image Online | AI Image Enhancer",
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
      "11111111-1111-1111-1111-111111111111",
      "ru",
      "EU",
    );

    if (job.agent !== "research") {
      throw new Error(
        `Unexpected agent: ${job.agent}`,
      );
    }

    if (job.task_type !== "topic_research") {
      throw new Error(
        `Unexpected task_type: ${job.task_type}`,
      );
    }

    if (job.status !== "queued") {
      throw new Error(
        `Unexpected status: ${job.status}`,
      );
    }

    if (job.priority !== 78) {
      throw new Error(
        `Expected priority 78, received ${job.priority}`,
      );
    }

    if (
      job.payload.candidate.url !==
        "https://airbrush.com/image-enhancer"
    ) {
      throw new Error("Candidate URL was not preserved");
    }

    if (
      job.payload.request_id !==
        "11111111-1111-1111-1111-111111111111"
    ) {
      throw new Error("Request ID was not preserved");
    }

    if (job.max_attempts !== 3) {
      throw new Error(
        `Expected max_attempts 3, received ${job.max_attempts}`,
      );
    }
  },
);