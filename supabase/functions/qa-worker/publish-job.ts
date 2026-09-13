import type {
  CreatedVyraJob,
  JobStore,
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import type { QaJob, QaResult } from "./qa.ts";
import { resolveQaExpandedTopicLineage } from "./qa-expanded-topic-lineage.ts";
import type {
  ResearchExpandedTopicLineage,
} from "../research-worker/research-expanded-topic-lineage.ts";

export type PublishJobPayload = {
  request_id: string;
  source_qa_job_id: string;
  source_content_job_id: string;
  source_research_job_id: string;
  content_id: string;
  language: string;
  title: string;
  slug: string;
  qa_score: number;
  topic_expansion?: ResearchExpandedTopicLineage;
  _meta: {
    dedupe_key: string;
  };
};

export type PublishJob = VyraJobInput & {
  agent: "publisher";
  task_type: "content_publish";
  payload: PublishJobPayload;
};

type PublishJobStore = Pick<
  JobStore,
  "createMany" | "existsByDedupeKey"
>;

export function buildPublishJob(
  sourceJob: QaJob,
  result: QaResult,
): PublishJob | null {
  if (result.content_id !== sourceJob.payload.content_id) {
    throw new Error("QA result content id mismatch");
  }

  if (result.status !== "approved") {
    return null;
  }

  if (
    !Number.isFinite(result.score) ||
    result.score < 0 ||
    result.score > 1
  ) {
    throw new Error("QA score must be between 0 and 1");
  }

  const dedupeKey = `${result.content_id}:content_publish`;
  const topicExpansion = resolveQaExpandedTopicLineage(sourceJob);

  return {
    agent: "publisher",
    task_type: "content_publish",
    status: "queued",
    priority: Math.round(result.score * 100),
    max_attempts: 3,
    payload: {
      request_id: sourceJob.payload.request_id,
      source_qa_job_id: sourceJob.id,
      source_content_job_id: sourceJob.payload.source_content_job_id,
      source_research_job_id: sourceJob.payload.source_research_job_id,
      content_id: result.content_id,
      language: sourceJob.payload.language,
      title: sourceJob.payload.title,
      slug: sourceJob.payload.slug,
      qa_score: result.score,
      ...(topicExpansion ? { topic_expansion: topicExpansion } : {}),
      _meta: {
        dedupe_key: dedupeKey,
      },
    },
  };
}

export async function enqueuePublishJob(
  store: PublishJobStore,
  sourceJob: QaJob,
  result: QaResult,
): Promise<CreatedVyraJob | null> {
  const publishJob = buildPublishJob(
    sourceJob,
    result,
  );

  if (!publishJob) {
    return null;
  }

  const dedupeKey = publishJob.payload._meta.dedupe_key;

  if (await store.existsByDedupeKey(dedupeKey)) {
    return null;
  }

  const created = await store.createMany([
    publishJob,
  ]);

  return created[0] ?? null;
}
