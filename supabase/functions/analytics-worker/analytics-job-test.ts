import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertAnalyticsJob,
} from "./analytics-job.ts";

function createJob(): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000000970",
    agent: "analytics",
    task_type: "referral_rollup",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000971",
      scope: "all",
      _meta: {
        dedupe_key:
          "00000000-0000-4000-8000-000000000971:referral_rollup",
      },
    },
  };
}

Deno.test(
  "assertAnalyticsJob accepts a full rollup contract",
  () => {
    const job = createJob();
    assertAnalyticsJob(job);

    if (job.payload.scope !== "all") {
      throw new Error("Analytics scope was not preserved");
    }
  },
);

Deno.test(
  "assertAnalyticsJob rejects an unsupported scope",
  () => {
    const job = createJob();

    if (!job.payload) {
      throw new Error("Fixture payload is required");
    }

    job.payload.scope = "single";
    let rejected = false;

    try {
      assertAnalyticsJob(job);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Unsupported Analytics scope was accepted",
      );
    }
  },
);
