export type TopicExpansionPayload = {
  request_id: string;
  source_repeat_job_id: string;
  source_content_id: string;
  referral_link_id: string;
  expansion: {
    action: "scale_content";
    reason: string;
    priority: number;
    metrics: {
      clicks: number;
      conversions: number;
      revenue: number;
      conversion_rate: number;
    };
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

export type TopicExpansionSource = {
  id: string;
  title: string;
  language: string;
  status: string;
  evidence: Record<string, unknown>;
};

export type TopicExpansionExecution = {
  request_id: string;
  language: string;
  region: string;
  topic_seed: string;
  constraints: {
    max_topics: number;
    min_score: number;
  };
  lineage: {
    source_repeat_job_id: string;
    source_content_id: string;
    referral_link_id: string;
  };
  safeguards: TopicExpansionPayload["safeguards"];
  _meta: {
    dedupe_key: string;
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

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function resolveEvidenceValue(
  evidence: Record<string, unknown>,
  field: "topic_seed" | "region",
): string | null {
  const direct = optionalString(evidence[field]);

  if (direct) {
    return direct;
  }

  for (const containerName of ["source", "lineage"] as const) {
    const container = evidence[containerName];

    if (isRecord(container)) {
      const nested = optionalString(container[field]);

      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

export function buildTopicExpansionExecution(
  payload: TopicExpansionPayload,
  source: TopicExpansionSource,
): TopicExpansionExecution {
  const requestId = requiredString(
    payload.request_id,
    "Topic expansion request id",
  );
  const sourceRepeatJobId = requiredString(
    payload.source_repeat_job_id,
    "Topic expansion source Repeat job id",
  );
  const sourceContentId = requiredString(
    payload.source_content_id,
    "Topic expansion source content id",
  );
  const referralLinkId = requiredString(
    payload.referral_link_id,
    "Topic expansion referral link id",
  );
  const dedupeKey = requiredString(
    payload._meta?.dedupe_key,
    "Topic expansion dedupe key",
  );

  if (payload.expansion?.action !== "scale_content") {
    throw new Error("Topic expansion requires scale_content");
  }

  if (
    !payload.safeguards?.preserve_source_content ||
    !payload.safeguards?.require_source_topic ||
    payload.safeguards?.allow_duplicate_topics !== false
  ) {
    throw new Error("Topic expansion safeguards are invalid");
  }

  if (requiredString(source.id, "Source content id") !== sourceContentId) {
    throw new Error("Topic expansion source content mismatch");
  }

  if (source.status !== "published") {
    throw new Error("Topic expansion source content must be published");
  }

  const topicSeed = resolveEvidenceValue(
    source.evidence,
    "topic_seed",
  ) ?? requiredString(source.title, "Source content topic");

  const region = resolveEvidenceValue(
    source.evidence,
    "region",
  ) ?? "global";

  return {
    request_id: requestId,
    language: requiredString(
      source.language,
      "Source content language",
    ),
    region,
    topic_seed: topicSeed,
    constraints: {
      max_topics: 10,
      min_score: 0.7,
    },
    lineage: {
      source_repeat_job_id: sourceRepeatJobId,
      source_content_id: sourceContentId,
      referral_link_id: referralLinkId,
    },
    safeguards: { ...payload.safeguards },
    _meta: {
      dedupe_key: `${dedupeKey}:execution`,
    },
  };
}
