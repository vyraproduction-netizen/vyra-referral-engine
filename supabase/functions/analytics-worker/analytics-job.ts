import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";

export type AnalyticsJobPayload = {
  request_id: string;
  scope: "all";
  _meta: {
    dedupe_key: string;
  };
};

export type AnalyticsJob = VyraJob & {
  payload: AnalyticsJobPayload;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

export function assertAnalyticsJob(
  job: VyraJob,
): asserts job is AnalyticsJob {
  if (job.agent !== "analytics") {
    throw new Error("Invalid Analytics agent");
  }

  if (job.task_type !== "referral_rollup") {
    throw new Error("Invalid Analytics task_type");
  }

  if (!isRecord(job.payload)) {
    throw new Error("Analytics job payload is required");
  }

  if (
    typeof job.payload.request_id !== "string" ||
    job.payload.request_id.length === 0
  ) {
    throw new Error(
      "Analytics payload.request_id is required",
    );
  }

  if (job.payload.scope !== "all") {
    throw new Error(
      "Analytics payload.scope must be all",
    );
  }
}
