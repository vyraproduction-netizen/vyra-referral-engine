import type {
  CreatedVyraJob,
  JobStore,
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import type {
  ContentDraft,
  ContentJob,
} from "./content.ts";

export type SavedContentDraft = {
  id: string;
  slug: string;
  status: string;
};

export type QaJobPayload = {
  request_id: string;
  source_content_job_id: string;
  source_research_job_id: string;
  content_id: string;
  language: string;
  title: string;
  slug: string;
  _meta: {
    dedupe_key: string;
  };
};

export type QaJob = VyraJobInput & {
  agent: "qa";
  task_type: "content_qa";
  payload: QaJobPayload;
};

type QaJobStore = Pick<
  JobStore,
  "createMany" | "existsByDedupeKey"
>;

export function buildQaJob(
  sourceJob: ContentJob,
  draft: ContentDraft,
  saved: SavedContentDraft,
): QaJob {
  if (!saved.id) {
    throw new Error("Saved content id is required");
  }

  if (saved.status !== "draft") {
    throw new Error(
      `QA requires draft content, received: ${saved.status}`,
    );
  }

  const dedupeKey = `${saved.id}:content_qa`;

  return {
    agent: "qa",
    task_type: "content_qa",
    status: "queued",
    priority: 100,
    max_attempts: 3,
    payload: {
      request_id: draft.request_id,
      source_content_job_id: sourceJob.id,
      source_research_job_id: draft.source_job_id,
      content_id: saved.id,
      language: draft.language,
      title: draft.title,
      slug: saved.slug,
      _meta: {
        dedupe_key: dedupeKey,
      },
    },
  };
}

export async function enqueueQaJob(
  store: QaJobStore,
  sourceJob: ContentJob,
  draft: ContentDraft,
  saved: SavedContentDraft,
): Promise<CreatedVyraJob | null> {
  const qaJob = buildQaJob(
    sourceJob,
    draft,
    saved,
  );

  const dedupeKey = qaJob.payload._meta.dedupe_key;

  if (await store.existsByDedupeKey(dedupeKey)) {
    return null;
  }

  const created = await store.createMany([qaJob]);
  return created[0] ?? null;
}
