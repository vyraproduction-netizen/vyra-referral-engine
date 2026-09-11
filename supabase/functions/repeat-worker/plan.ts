import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";

export type RepeatWorkerTaskType =
  | "content_improvement"
  | "topic_expansion";

export type RepeatWorkerAction =
  | "improve_content"
  | "scale_content";

export type RepeatWorkerJob = VyraJob & {
  agent: "repeat";
  task_type: RepeatWorkerTaskType;
  payload: {
    request_id: string;
    source_job_id: string;
    source_content_id: string;
    referral_link_id: string;
    optimization: {
      action: RepeatWorkerAction;
      reason: string;
      priority: number;
      conversion_rate: number;
      metrics: {
        clicks: number;
        conversions: number;
        revenue: number;
      };
    };
    _meta: {
      dedupe_key: string;
    };
  };
};

export type RepeatExecutionPlan = {
  source_repeat_job_id: string;
  request_id: string;
  source_content_id: string;
  referral_link_id: string;
  action: RepeatWorkerAction;
  target: {
    agent: "content" | "topic_scout";
    task_type: "content_revision" | "topic_expansion";
  };
  reason: string;
  priority: number;
  metrics: {
    clicks: number;
    conversions: number;
    revenue: number;
    conversion_rate: number;
  };
  dedupe_key: string;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

function nonNegativeNumber(
  value: unknown,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new Error(`${field} must be a non-negative number`);
  }

  return value;
}

export function assertRepeatWorkerJob(
  job: VyraJob,
): asserts job is RepeatWorkerJob {
  if (job.agent !== "repeat") {
    throw new Error("Invalid Repeat agent");
  }

  if (
    job.task_type !== "content_improvement" &&
    job.task_type !== "topic_expansion"
  ) {
    throw new Error("Invalid Repeat task_type");
  }

  const payload = job.payload;

  if (!isRecord(payload)) {
    throw new Error("Repeat job payload is required");
  }

  for (
    const field of [
      "request_id",
      "source_job_id",
      "source_content_id",
      "referral_link_id",
    ] as const
  ) {
    requiredString(payload[field], `Repeat payload.${field}`);
  }

  if (!isRecord(payload._meta)) {
    throw new Error("Repeat payload._meta is required");
  }

  requiredString(
    payload._meta.dedupe_key,
    "Repeat payload._meta.dedupe_key",
  );

  if (!isRecord(payload.optimization)) {
    throw new Error("Repeat payload.optimization is required");
  }

  const optimization = payload.optimization;
  const expectedAction = job.task_type === "content_improvement"
    ? "improve_content"
    : "scale_content";

  if (optimization.action !== expectedAction) {
    throw new Error(
      "Repeat task_type does not match optimization action",
    );
  }

  requiredString(
    optimization.reason,
    "Repeat optimization.reason",
  );
  nonNegativeNumber(
    optimization.priority,
    "Repeat optimization.priority",
  );
  nonNegativeNumber(
    optimization.conversion_rate,
    "Repeat optimization.conversion_rate",
  );

  if (!isRecord(optimization.metrics)) {
    throw new Error("Repeat optimization.metrics is required");
  }

  for (const field of ["clicks", "conversions", "revenue"] as const) {
    nonNegativeNumber(
      optimization.metrics[field],
      `Repeat optimization.metrics.${field}`,
    );
  }
}

export function buildRepeatExecutionPlan(
  job: RepeatWorkerJob,
): RepeatExecutionPlan {
  const optimization = job.payload.optimization;
  const target = job.task_type === "content_improvement"
    ? {
      agent: "content" as const,
      task_type: "content_revision" as const,
    }
    : {
      agent: "topic_scout" as const,
      task_type: "topic_expansion" as const,
    };

  return {
    source_repeat_job_id: job.id,
    request_id: job.payload.request_id,
    source_content_id: job.payload.source_content_id,
    referral_link_id: job.payload.referral_link_id,
    action: optimization.action,
    target,
    reason: optimization.reason,
    priority: optimization.priority,
    metrics: {
      ...optimization.metrics,
      conversion_rate: optimization.conversion_rate,
    },
    dedupe_key: `${job.payload._meta.dedupe_key}:plan`,
  };
}
