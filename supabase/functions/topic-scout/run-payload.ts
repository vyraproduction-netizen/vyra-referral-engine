import {
  buildTopicExpansionExecution,
} from "./topic-expansion.ts";
import type {
  TopicExpansionExecution,
  TopicExpansionPayload,
  TopicExpansionSource,
} from "./topic-expansion.ts";

export type TopicScoutPayload = {
  request_id: string;
  language: string;
  region: string;
  topic_seed: string;
  constraints?: {
    max_topics?: number;
    min_score?: number;
  };
};

export type TopicExpansionSourceLoader = (
  contentId: string,
) => Promise<TopicExpansionSource>;

export type ResolvedTopicScoutPayload = {
  payload: TopicScoutPayload;
  expansion: TopicExpansionExecution | null;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

export function isTopicScoutPayload(
  payload: unknown,
): payload is TopicScoutPayload {
  if (!isRecord(payload)) {
    return false;
  }

  return typeof payload.request_id === "string" &&
    typeof payload.language === "string" &&
    typeof payload.region === "string" &&
    typeof payload.topic_seed === "string" &&
    payload.topic_seed.trim().length > 0;
}

function isTopicExpansionPayload(
  payload: unknown,
): payload is TopicExpansionPayload {
  if (!isRecord(payload)) {
    return false;
  }

  return typeof payload.source_content_id === "string" &&
    isRecord(payload.expansion) &&
    payload.expansion.action === "scale_content";
}

export async function resolveTopicScoutPayload(
  payload: unknown,
  loadSource: TopicExpansionSourceLoader,
): Promise<ResolvedTopicScoutPayload> {
  if (isTopicScoutPayload(payload)) {
    return {
      payload,
      expansion: null,
    };
  }

  if (!isTopicExpansionPayload(payload)) {
    throw new Error("Invalid payload");
  }

  const source = await loadSource(payload.source_content_id);
  const expansion = buildTopicExpansionExecution(payload, source);

  return {
    payload: {
      request_id: expansion.request_id,
      language: expansion.language,
      region: expansion.region,
      topic_seed: expansion.topic_seed,
      constraints: { ...expansion.constraints },
    },
    expansion,
  };
}
