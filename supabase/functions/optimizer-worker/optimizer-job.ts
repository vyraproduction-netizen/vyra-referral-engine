import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";

export type OptimizerJobPayload = {
  request_id: string;
  scope: "all";
  _meta: {
    dedupe_key: string;
  };
};

export type OptimizerJob = VyraJob & {
  payload: OptimizerJobPayload;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

export function assertOptimizerJob(
  job: VyraJob,
): asserts job is OptimizerJob {
  if (job.agent !== "optimizer") {
    throw new Error("Invalid Optimizer agent");
  }

  if (job.task_type !== "performance_optimization") {
    throw new Error("Invalid Optimizer task_type");
  }

  if (!isRecord(job.payload)) {
    throw new Error("Optimizer job payload is required");
  }

  if (
    typeof job.payload.request_id !== "string" ||
    job.payload.request_id.trim().length === 0
  ) {
    throw new Error(
      "Optimizer payload.request_id is required",
    );
  }

  if (job.payload.scope !== "all") {
    throw new Error(
      "Optimizer payload.scope must be all",
    );
  }

  const meta = job.payload._meta;

  if (
    !isRecord(meta) ||
    typeof meta.dedupe_key !== "string" ||
    meta.dedupe_key.trim().length === 0
  ) {
    throw new Error(
      "Optimizer payload._meta.dedupe_key is required",
    );
  }
}
