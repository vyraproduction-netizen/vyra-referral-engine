import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import type {
  PublishJobPayload,
} from "../qa-worker/publish-job.ts";
import type {
  PublisherProvider,
} from "./publisher-provider.ts";

export type PublisherJob = VyraJob & {
  payload: PublishJobPayload;
};

export type PublisherContent = {
  id: string;
  title: string;
  slug: string;
  language: string;
  status: string;
  body: string | null;
  excerpt: string | null;
  meta_title: string | null;
  meta_description: string | null;
  published_url: string | null;
};

export type PublishResult = {
  content_id: string;
  slug: string;
  published_url: string;
  provider: string;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

export function assertPublisherJob(
  job: VyraJob,
): asserts job is PublisherJob {
  if (job.agent !== "publisher") {
    throw new Error("Invalid Publisher agent");
  }

  if (job.task_type !== "content_publish") {
    throw new Error("Invalid Publisher task_type");
  }

  if (!isRecord(job.payload)) {
    throw new Error("Publisher job payload is required");
  }

  const requiredFields = [
    "request_id",
    "source_qa_job_id",
    "source_content_job_id",
    "source_research_job_id",
    "content_id",
    "language",
    "title",
    "slug",
  ] as const;

  for (const field of requiredFields) {
    if (
      typeof job.payload[field] !== "string" ||
      job.payload[field].length === 0
    ) {
      throw new Error(
        `Publisher payload.${field} is required`,
      );
    }
  }

  if (
    typeof job.payload.qa_score !== "number" ||
    !Number.isFinite(job.payload.qa_score) ||
    job.payload.qa_score < 0.8 ||
    job.payload.qa_score > 1
  ) {
    throw new Error(
      "Publisher payload.qa_score must be between 0.8 and 1",
    );
  }
}

export async function runPublisher(
  job: PublisherJob,
  content: PublisherContent,
  provider: PublisherProvider,
): Promise<PublishResult> {
  if (content.id !== job.payload.content_id) {
    throw new Error("Publisher content id mismatch");
  }

  if (content.slug !== job.payload.slug) {
    throw new Error("Publisher content slug mismatch");
  }

  if (content.status !== "approved") {
    throw new Error(
      `Publisher requires approved content, received: ${content.status}`,
    );
  }

  if (!content.body?.trim()) {
    throw new Error("Publisher content body is required");
  }

  const receipt = await provider.publish({
    content_id: content.id,
    language: content.language,
    title: content.title,
    slug: content.slug,
    body: content.body,
    excerpt: content.excerpt,
    meta_title: content.meta_title,
    meta_description: content.meta_description,
  });

  if (!receipt.published_url) {
    throw new Error(
      "Publisher provider returned no URL",
    );
  }

  return {
    content_id: content.id,
    slug: content.slug,
    published_url: receipt.published_url,
    provider: receipt.provider,
  };
}
