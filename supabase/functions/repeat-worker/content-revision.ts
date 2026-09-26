import type {
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";

export type ContentRevisionJobPayload = {
  request_id: string;
  source_repeat_job_id: string;
  source_content_id: string;
  referral_link_id: string;
  revision: {
    action: "improve_content";
    reason: string;
    priority: number;
    metrics: RepeatExecutionPlan["metrics"];
  };
  safeguards: {
    preserve_source_content: true;
    allow_published_overwrite: false;
    reuse_source_slug: false;
  };
  _meta: {
    dedupe_key: string;
  };
};

export type ContentRevisionJob = VyraJobInput & {
  agent: "content";
  task_type: "content_revision";
  payload: ContentRevisionJobPayload;
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

function assertContentRevisionPlan(
  plan: RepeatExecutionPlan,
): void {
  if (plan.action !== "improve_content") {
    throw new Error(
      "Content revision requires improve_content",
    );
  }

  if (
    plan.target.agent !== "content" ||
    plan.target.task_type !== "content_revision"
  ) {
    throw new Error(
      "Content revision plan target is invalid",
    );
  }

  requiredString(
    plan.source_repeat_job_id,
    "Content revision source Repeat job id",
  );
  requiredString(
    plan.request_id,
    "Content revision request id",
  );
  requiredString(
    plan.source_content_id,
    "Content revision source content id",
  );
  requiredString(
    plan.referral_link_id,
    "Content revision referral link id",
  );
  requiredString(
    plan.reason,
    "Content revision reason",
  );
  requiredString(
    plan.dedupe_key,
    "Content revision plan dedupe key",
  );
}

export function buildContentRevisionJob(
  plan: RepeatExecutionPlan,
): ContentRevisionJob {
  assertContentRevisionPlan(plan);

  return {
    agent: "content",
    task_type: "content_revision",
    status: "queued",
    priority: plan.priority,
    max_attempts: 3,
    payload: {
      request_id: plan.request_id,
      source_repeat_job_id:
        plan.source_repeat_job_id,
      source_content_id: plan.source_content_id,
      referral_link_id: plan.referral_link_id,
      revision: {
        action: "improve_content",
        reason: plan.reason,
        priority: plan.priority,
        metrics: { ...plan.metrics },
      },
      safeguards: {
        preserve_source_content: true,
        allow_published_overwrite: false,
        reuse_source_slug: false,
      },
      _meta: {
        dedupe_key:
          `${plan.dedupe_key}:content_revision`,
      },
    },
  };
}
