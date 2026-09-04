import type {
  ResearchJob,
} from "./research-job.ts";
import type {
  TopicExpansionExecution,
} from "./topic-expansion.ts";

export type ExpandedTopicResearchLineage = {
  source_repeat_job_id: string;
  source_content_id: string;
  referral_link_id: string;
  execution_dedupe_key: string;
};

export type ExpandedTopicResearchJob = ResearchJob & {
  payload: ResearchJob["payload"] & {
    topic_expansion: {
      lineage: ExpandedTopicResearchLineage;
      safeguards: TopicExpansionExecution["safeguards"];
    };
  };
};

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

function assertMatchingValue(
  actual: string,
  expected: string,
  field: string,
): void {
  if (actual !== expected) {
    throw new Error(`Expanded-topic Research ${field} mismatch`);
  }
}

export function attachTopicExpansionLineage(
  job: ResearchJob,
  expansion: TopicExpansionExecution,
): ExpandedTopicResearchJob {
  if (job.agent !== "research" || job.task_type !== "topic_research") {
    throw new Error("Expanded-topic Research job contract is invalid");
  }

  const requestId = requiredString(
    expansion.request_id,
    "Topic expansion request id",
  );
  const sourceRepeatJobId = requiredString(
    expansion.lineage?.source_repeat_job_id,
    "Topic expansion source Repeat job id",
  );
  const sourceContentId = requiredString(
    expansion.lineage?.source_content_id,
    "Topic expansion source content id",
  );
  const referralLinkId = requiredString(
    expansion.lineage?.referral_link_id,
    "Topic expansion referral link id",
  );
  const executionDedupeKey = requiredString(
    expansion._meta?.dedupe_key,
    "Topic expansion execution dedupe key",
  );

  assertMatchingValue(
    job.payload.request_id,
    requestId,
    "request id",
  );
  assertMatchingValue(
    job.payload.language,
    expansion.language,
    "language",
  );
  assertMatchingValue(
    job.payload.region,
    expansion.region,
    "region",
  );
  assertMatchingValue(
    job.payload.topic_seed,
    expansion.topic_seed,
    "topic seed",
  );

  if (
    !expansion.safeguards?.preserve_source_content ||
    !expansion.safeguards?.require_source_topic ||
    expansion.safeguards?.allow_duplicate_topics !== false
  ) {
    throw new Error("Topic expansion safeguards are invalid");
  }

  return {
    ...job,
    payload: {
      ...job.payload,
      topic_expansion: {
        lineage: {
          source_repeat_job_id: sourceRepeatJobId,
          source_content_id: sourceContentId,
          referral_link_id: referralLinkId,
          execution_dedupe_key: executionDedupeKey,
        },
        safeguards: { ...expansion.safeguards },
      },
    },
  };
}

export function attachTopicExpansionLineageToJobs(
  jobs: ResearchJob[],
  expansion: TopicExpansionExecution | null,
): ResearchJob[] {
  if (!expansion) {
    return jobs;
  }

  return jobs.map((job) =>
    attachTopicExpansionLineage(job, expansion)
  );
}
