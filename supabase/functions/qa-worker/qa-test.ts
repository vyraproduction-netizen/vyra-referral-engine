import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertQaJob,
  evaluateContent,
} from "./qa.ts";

function createQaJob(): VyraJob {
  return {
    id: "00000000-0000-4000-8000-000000000916",
    agent: "qa",
    task_type: "content_qa",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000916",
      source_content_job_id:
        "00000000-0000-4000-8000-000000000915",
      source_research_job_id:
        "00000000-0000-4000-8000-000000000914",
      content_id:
        "00000000-0000-4000-8000-000000000917",
      language: "ru",
      title: "Example Enhancer: обзор возможностей",
      slug: "example-enhancer-ru",
      _meta: {
        dedupe_key:
          "00000000-0000-4000-8000-000000000917:content_qa",
      },
    },
  };
}

function createContent() {
  return {
    id: "00000000-0000-4000-8000-000000000917",
    title: "Example Enhancer: обзор возможностей",
    slug: "example-enhancer-ru",
    language: "ru",
    status: "draft",
    body: "A".repeat(400),
    excerpt:
      "Подробный обзор сервиса на основе проверенных исследовательских данных.",
    meta_title:
      "Example Enhancer: обзор возможностей",
    meta_description:
      "Возможности Example Enhancer, результаты исследования и доступные программы рекомендаций.",
    evidence: {
      research: {
        answer: "A referral program may be available.",
        sources: [
          {
            title: "Example source",
            url: "https://example.local/source",
          },
        ],
      },
    },
  };
}

Deno.test(
  "QA contract accepts a valid job",
  () => {
    const job = createQaJob();
    assertQaJob(job);

    if (
      job.payload.content_id !==
        "00000000-0000-4000-8000-000000000917"
    ) {
      throw new Error("QA content id was not preserved");
    }
  },
);

Deno.test(
  "QA approves a complete draft",
  () => {
    const result = evaluateContent(createContent());

    if (result.status !== "approved") {
      throw new Error("Complete draft was not approved");
    }

    if (result.score !== 1) {
      throw new Error(
        `Expected score 1, received ${result.score}`,
      );
    }
  },
);

Deno.test(
  "QA rejects an incomplete draft",
  () => {
    const content = createContent();
    const result = evaluateContent({
      ...content,
      body: "Too short",
      excerpt: null,
      meta_description: null,
      evidence: {},
    });

    if (result.status !== "rejected") {
      throw new Error("Incomplete draft was not rejected");
    }

    if (result.score >= 0.8) {
      throw new Error("Incomplete draft score is too high");
    }
  },
);

Deno.test(
  "QA contract rejects a wrong agent",
  () => {
    const job = createQaJob();
    job.agent = "content";
    let rejected = false;

    try {
      assertQaJob(job);
    } catch {
      rejected = true;
    }

    if (!rejected) {
      throw new Error("Wrong QA agent was accepted");
    }
  },
);
