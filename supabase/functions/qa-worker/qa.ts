import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import type {
  QaJobPayload,
} from "../content-worker/qa-job.ts";

export type QaJob = VyraJob & {
  payload: QaJobPayload;
};

export type QaContent = {
  id: string;
  title: string;
  slug: string;
  language: string;
  status: string;
  body: string | null;
  excerpt: string | null;
  meta_title: string | null;
  meta_description: string | null;
  evidence: Record<string, unknown>;
};

export type QaCheck = {
  name: string;
  passed: boolean;
  weight: number;
};

export type QaResult = {
  content_id: string;
  score: number;
  status: "approved" | "rejected";
  checks: QaCheck[];
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

export function assertQaJob(
  job: VyraJob,
): asserts job is QaJob {
  if (job.agent !== "qa") {
    throw new Error("Invalid QA agent");
  }

  if (job.task_type !== "content_qa") {
    throw new Error("Invalid QA task_type");
  }

  if (!isRecord(job.payload)) {
    throw new Error("QA job payload is required");
  }

  const requiredFields = [
    "request_id",
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
      throw new Error(`QA payload.${field} is required`);
    }
  }
}

function hasResearchEvidence(
  evidence: Record<string, unknown>,
): boolean {
  const research = evidence.research;

  return isRecord(research) &&
    Array.isArray(research.sources) &&
    research.sources.length > 0;
}

function hasLengthInRange(
  value: string | null,
  minimum: number,
  maximum: number,
): boolean {
  if (!value) {
    return false;
  }

  const length = value.trim().length;
  return length >= minimum && length <= maximum;
}

export function evaluateContent(
  content: QaContent,
): QaResult {
  if (content.status !== "draft") {
    throw new Error(
      `QA requires draft content, received: ${content.status}`,
    );
  }

  const checks: QaCheck[] = [
    {
      name: "body_length",
      passed: hasLengthInRange(
        content.body,
        200,
        20000,
      ),
      weight: 0.3,
    },
    {
      name: "title_length",
      passed: hasLengthInRange(
        content.title,
        10,
        120,
      ),
      weight: 0.15,
    },
    {
      name: "excerpt_length",
      passed: hasLengthInRange(
        content.excerpt,
        40,
        240,
      ),
      weight: 0.15,
    },
    {
      name: "meta_title_length",
      passed: hasLengthInRange(
        content.meta_title,
        10,
        70,
      ),
      weight: 0.1,
    },
    {
      name: "meta_description_length",
      passed: hasLengthInRange(
        content.meta_description,
        50,
        180,
      ),
      weight: 0.1,
    },
    {
      name: "research_evidence",
      passed: hasResearchEvidence(content.evidence),
      weight: 0.2,
    },
  ];

  const score = Number(
    checks
      .filter((check) => check.passed)
      .reduce(
        (total, check) => total + check.weight,
        0,
      )
      .toFixed(2),
  );

  return {
    content_id: content.id,
    score,
    status: score >= 0.8
      ? "approved"
      : "rejected",
    checks,
  };
}
