import type {
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";

export type TopicExpansionJobPayload = {
  request_id: string;
  source_repeat_job_id: string;
  source_content_id: string;
  referral_link_id: string;
  expansion: {
    action: "scale_content";
    reason: string;
    priority: number;
    metrics: RepeatExecutionPlan["metrics"];
  };
  safeguards: {
    preserve_source_content: true;
    require_source_topic: true;
    allow_duplicate_topics: false;
  };
  _meta: {
    dedupe_key: string;
  };
};

export type TopicExpansionJob = VyraJobInput & {
  agent: "topic_scout";
  task_type: "topic_expansion";
  payload: TopicExpansionJobPayload;
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

function assertTopicExpansionPlan(
  plan: RepeatExecutionPlan,
): void {
  if (plan.action !== "scale_content") {
    throw new Error(
      "Topic expansion requires scale_content",
    );
  }

  if (
    plan.target.agent !== "topic_scout" ||
    plan.target.task_type !== "topic_expansion"
  ) {
    throw new Error(
      "Topic expansion plan target is invalid",
    );
  }

  requiredString(
    plan.source_repeat_job_id,
    "Topic expansion source Repeat job id",
  );
  requiredString(
    plan.request_id,
    "Topic expansion request id",
  );
  requiredString(
    plan.source_content_id,
    "Topic expansion source content id",
  );
  requiredString(
    plan.referral_link_id,
    "Topic expansion referral link id",
  );
  requiredString(
    plan.reason,
    "Topic expansion reason",
  );
  requiredString(
    plan.dedupe_key,
    "Topic expansion plan dedupe key",
  );
}

export function buildTopicExpansionJob(
  plan: RepeatExecutionPlan,
): TopicExpansionJob {
  assertTopicExpansionPlan(plan);

  return {
    agent: "topic_scout",
    task_type: "topic_expansion",
    status: "queued",
    priority: plan.priority,
    max_attempts: 3,
    payload: {
      request_id: plan.request_id,
      source_repeat_job_id:
        plan.source_repeat_job_id,
      source_content_id: plan.source_content_id,
      referral_link_id: plan.referral_link_id,
      expansion: {
        action: "scale_content",
        reason: plan.reason,
        priority: plan.priority,
        metrics: { ...plan.metrics },
      },
      safeguards: {
        preserve_source_content: true,
        require_source_topic: true,
        allow_duplicate_topics: false,
      },
      _meta: {
        dedupe_key:
          `${plan.dedupe_key}:topic_expansion`,
      },
    },
  };
}
