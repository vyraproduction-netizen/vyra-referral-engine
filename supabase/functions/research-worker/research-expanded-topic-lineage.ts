import type {
  ResearchJob,
} from "./research.ts";

export type ResearchExpandedTopicLineage = {
  lineage: {
    source_repeat_job_id: string;
    source_content_id: string;
    referral_link_id: string;
    execution_dedupe_key: string;
  };
  safeguards: {
    preserve_source_content: true;
    require_source_topic: true;
    allow_duplicate_topics: false;
  };
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

export function resolveResearchExpandedTopicLineage(
  job: ResearchJob,
): ResearchExpandedTopicLineage | null {
  const payload = job.payload as unknown as Record<string, unknown>;
  const topicExpansion = payload.topic_expansion;

  if (topicExpansion === undefined) {
    return null;
  }

  if (!isRecord(topicExpansion)) {
    throw new Error("Research topic expansion metadata is invalid");
  }

  const lineage = topicExpansion.lineage;
  const safeguards = topicExpansion.safeguards;

  if (!isRecord(lineage)) {
    throw new Error("Research topic expansion lineage is required");
  }

  if (!isRecord(safeguards)) {
    throw new Error("Research topic expansion safeguards are required");
  }

  if (
    safeguards.preserve_source_content !== true ||
    safeguards.require_source_topic !== true ||
    safeguards.allow_duplicate_topics !== false
  ) {
    throw new Error("Research topic expansion safeguards are invalid");
  }

  return {
    lineage: {
      source_repeat_job_id: requiredString(
        lineage.source_repeat_job_id,
        "Research source Repeat job id",
      ),
      source_content_id: requiredString(
        lineage.source_content_id,
        "Research source content id",
      ),
      referral_link_id: requiredString(
        lineage.referral_link_id,
        "Research referral link id",
      ),
      execution_dedupe_key: requiredString(
        lineage.execution_dedupe_key,
        "Research expansion execution dedupe key",
      ),
    },
    safeguards: {
      preserve_source_content: true,
      require_source_topic: true,
      allow_duplicate_topics: false,
    },
  };
}
