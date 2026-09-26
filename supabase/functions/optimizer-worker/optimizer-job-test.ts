import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertOptimizerJob,
} from "./optimizer-job.ts";

function createJob(): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000002100",
    agent: "optimizer",
    task_type: "performance_optimization",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000002101",
      scope: "all",
      _meta: {
        dedupe_key:
          "00000000-0000-4000-8000-000000002101:performance_optimization",
      },
    },
  };
}

Deno.test(
  "assertOptimizerJob accepts a full optimization contract",
  () => {
    const job = createJob();
    assertOptimizerJob(job);

    if (job.payload.scope !== "all") {
      throw new Error("Optimizer scope was not preserved");
    }
  },
);

Deno.test(
  "assertOptimizerJob rejects an unsupported scope",
  () => {
    const job = createJob();

    if (!job.payload) {
      throw new Error("Fixture payload is required");
    }

    job.payload.scope = "single";

    let rejected = false;

    try {
      assertOptimizerJob(job);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Unsupported Optimizer scope was accepted",
      );
    }
  },
);

Deno.test(
  "assertOptimizerJob requires a dedupe key",
  () => {
    const job = createJob();

    if (!job.payload || !job.payload._meta) {
      throw new Error("Fixture metadata is required");
    }

    const meta = job.payload._meta as
      Record<string, unknown>;

    meta.dedupe_key = "";

    let rejected = false;

    try {
      assertOptimizerJob(job);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error(
        "Missing Optimizer dedupe key was accepted",
      );
    }
  },
);
