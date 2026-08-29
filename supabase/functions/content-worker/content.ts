import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import type {
  ContentJobPayload,
} from "../research-worker/content-job.ts";
import type {
  ContentProvider,
} from "./content-provider.ts";

export type ContentJob = VyraJob & {
  payload: ContentJobPayload;
};

export type ContentDraft = {
  source_job_id: string;
  request_id: string;
  title: string;
  slug: string;
  content_type: "article";
  language: string;
  status: "draft";
  body: string;
  excerpt: string;
  meta_title: string;
  meta_description: string;
  evidence: Record<string, unknown>;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

export function assertContentJob(
  job: VyraJob,
): asserts job is ContentJob {
  if (job.agent !== "content") {
    throw new Error("Invalid content agent");
  }

  if (job.task_type !== "content_draft") {
    throw new Error("Invalid content task_type");
  }

  const payload = job.payload;

  if (!isRecord(payload)) {
    throw new Error("Content job payload is required");
  }

  const candidate = payload.candidate;
  const research = payload.research;
  const evidence = payload.evidence;

  if (!isRecord(candidate)) {
    throw new Error("Content candidate is required");
  }

  if (!isRecord(research)) {
    throw new Error("Content research is required");
  }

  if (!isRecord(evidence)) {
    throw new Error("Content evidence is required");
  }

  const payloadFields = [
    "request_id",
    "language",
    "region",
    "topic_seed",
    "source_job_id",
    "recommendation",
  ] as const;

  for (const field of payloadFields) {
    if (
      typeof payload[field] !== "string" ||
      payload[field].length === 0
    ) {
      throw new Error(`Content payload.${field} is required`);
    }
  }

  for (const field of ["title", "url"] as const) {
    if (
      typeof candidate[field] !== "string" ||
      candidate[field].length === 0
    ) {
      throw new Error(`Content candidate.${field} is required`);
    }
  }

  if (!Array.isArray(research.sources)) {
    throw new Error("Content research.sources must be an array");
  }
}

export function createContentSlug(
  candidateUrl: string,
  language: string,
): string {
  const url = new URL(candidateUrl);
  const source = `${url.hostname}${url.pathname}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);

  const languagePart = language
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!source || !languagePart) {
    throw new Error("Unable to create content slug");
  }

  return `${source}-${languagePart}`;
}

export async function runContent(
  job: ContentJob,
  provider: ContentProvider,
): Promise<ContentDraft> {
  const generated = await provider({
    title: job.payload.candidate.title,
    url: job.payload.candidate.url,
    language: job.payload.language,
    region: job.payload.region,
    topic_seed: job.payload.topic_seed,
    recommendation: job.payload.recommendation,
    research_answer: job.payload.research.answer,
    research_sources: job.payload.research.sources,
  });

  return {
    source_job_id: job.payload.source_job_id,
    request_id: job.payload.request_id,
    title: generated.title,
    slug: createContentSlug(
      job.payload.candidate.url,
      job.payload.language,
    ),
    content_type: "article",
    language: job.payload.language,
    status: "draft",
    body: generated.body,
    excerpt: generated.excerpt,
    meta_title: generated.meta_title,
    meta_description: generated.meta_description,
    evidence: {
      candidate: job.payload.candidate,
      recommendation: job.payload.recommendation,
      research: job.payload.research,
      scores: job.payload.evidence,
    },
  };
}
