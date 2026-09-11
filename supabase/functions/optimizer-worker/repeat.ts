import type {
  OptimizationDecision,
} from "./optimizer.ts";

export type RepeatableOptimizationAction =
  | "improve_content"
  | "scale_content";

export type RepeatSource = {
  job_id: string;
  request_id: string;
};

export type RepeatJob = {
  agent: "repeat";
  task_type: "content_improvement" | "topic_expansion";
  status: "queued";
  priority: number;
  max_attempts: 3;
  payload: {
    request_id: string;
    source_job_id: string;
    source_content_id: string;
    referral_link_id: string;
    optimization: {
      action: RepeatableOptimizationAction;
      reason: string;
      priority: number;
      conversion_rate: number;
      metrics: OptimizationDecision["metrics"];
    };
    _meta: {
      dedupe_key: string;
    };
  };
};

function requiredString(
  value: string,
  field: string,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function repeatRoute(
  action: RepeatableOptimizationAction,
): RepeatJob["task_type"] {
  return action === "improve_content"
    ? "content_improvement"
    : "topic_expansion";
}

function metricToken(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(
      "Repeat optimization metrics must be non-negative numbers",
    );
  }

  return String(value);
}

export function buildRepeatJob(
  source: RepeatSource,
  decision: OptimizationDecision,
): RepeatJob | null {
  if (
    decision.action !== "improve_content" &&
    decision.action !== "scale_content"
  ) {
    return null;
  }

  const action = decision.action;
  const taskType = repeatRoute(action);

  const sourceJobId = requiredString(
    source.job_id,
    "Repeat source job id",
  );
  const requestId = requiredString(
    source.request_id,
    "Repeat request id",
  );
  const contentId = requiredString(
    decision.content_id,
    "Repeat content id",
  );
  const referralLinkId = requiredString(
    decision.referral_link_id,
    "Repeat referral link id",
  );
  const clicks = metricToken(decision.metrics.clicks);
  const conversions = metricToken(
    decision.metrics.conversions,
  );
  const revenue = metricToken(decision.metrics.revenue);

  const dedupeKey = [
    "repeat",
    action,
    contentId,
    referralLinkId,
    clicks,
    conversions,
    revenue,
  ].join(":");

  return {
    agent: "repeat",
    task_type: taskType,
    status: "queued",
    priority: decision.priority,
    max_attempts: 3,
    payload: {
      request_id: requestId,
      source_job_id: sourceJobId,
      source_content_id: contentId,
      referral_link_id: referralLinkId,
      optimization: {
        action,
        reason: decision.reason,
        priority: decision.priority,
        conversion_rate: decision.conversion_rate,
        metrics: decision.metrics,
      },
      _meta: {
        dedupe_key: dedupeKey,
      },
    },
  };
}
