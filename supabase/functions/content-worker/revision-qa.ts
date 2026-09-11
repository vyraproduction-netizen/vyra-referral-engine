import type {
  CreatedVyraJob,
  JobStore,
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import type {
  ContentRevisionDraft,
  ContentRevisionJob,
} from "./revision.ts";
import type {
  SavedContentRevision,
} from "./revision-rpc.ts";

type RevisionQaJobStore = Pick<
  JobStore,
  "createMany" | "existsByDedupeKey"
>;

export type RevisionQaJob = VyraJobInput & {
  agent: "qa";
  task_type: "content_qa";
  payload: {
    request_id: string;
    source_content_job_id: string;
    source_research_job_id: string;
    content_id: string;
    language: string;
    title: string;
    slug: string;
    _meta: {
      dedupe_key: string;
      source_kind: "content_revision";
      source_content_id: string;
      revision_number: number;
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

export function buildRevisionQaJob(
  sourceJob: ContentRevisionJob,
  draft: ContentRevisionDraft,
  saved: SavedContentRevision,
): RevisionQaJob {
  if (saved.status !== "draft") {
    throw new Error(
      `Revision QA requires draft content, received: ${saved.status}`,
    );
  }

  if (saved.revision_job_id !== sourceJob.id) {
    throw new Error("Revision QA job lineage mismatch");
  }

  if (
    saved.source_content_id !==
      draft.source_content_id
  ) {
    throw new Error("Revision QA source lineage mismatch");
  }

  const sourceResearchJobId = requiredString(
    draft.evidence.source_job_id,
    "Revision source research job id",
  );
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
      source_research_job_id: sourceResearchJobId,
      content_id: saved.id,
      language: draft.language,
      title: draft.title,
      slug: saved.slug,
      _meta: {
        dedupe_key: dedupeKey,
        source_kind: "content_revision",
        source_content_id: saved.source_content_id,
        revision_number: saved.revision_number,
      },
    },
  };
}

export async function enqueueRevisionQaJob(
  store: RevisionQaJobStore,
  sourceJob: ContentRevisionJob,
  draft: ContentRevisionDraft,
  saved: SavedContentRevision,
): Promise<CreatedVyraJob | null> {
  const qaJob = buildRevisionQaJob(
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
