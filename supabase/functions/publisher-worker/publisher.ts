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
  provider: PublisherProvider,
): Promise<PublishResult> {
  const receipt = await provider.publish({
    content_id: job.payload.content_id,
    language: job.payload.language,
    title: job.payload.title,
    slug: job.payload.slug,
  });

  if (!receipt.published_url) {
    throw new Error(
      "Publisher provider returned no URL",
    );
  }

  return {
    content_id: job.payload.content_id,
    slug: job.payload.slug,
    published_url: receipt.published_url,
    provider: receipt.provider,
  };
}
