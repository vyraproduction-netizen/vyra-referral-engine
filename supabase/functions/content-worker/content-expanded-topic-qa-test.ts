import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertContentJob,
  type ContentJob,
  runContent,
} from "./content.ts";
import type {
  ContentProvider,
} from "./content-provider.ts";
import {
  buildQaJob,
} from "./qa-job.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const topicExpansion = {
  lineage: {
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000008300",
    source_content_id:
      "00000000-0000-4000-8000-000000008301",
    referral_link_id:
      "00000000-0000-4000-8000-000000008302",
    execution_dedupe_key:
      "runtime:expanded-topic:8300:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function createJob(value?: unknown): ContentJob {
  const job: VyraJob = {
    id: "00000000-0000-4000-8000-000000008303",
    agent: "content",
    task_type: "content_draft",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000008304",
      language: "en",
      region: "EU",
      topic_seed: "expanded AI tools",
      source_job_id: "00000000-0000-4000-8000-000000008305",
      candidate: {
        title: "Expanded AI Tool",
        url: "https://example.local/expanded-ai-tool",
      },
      recommendation: "content_candidate",
      research: {
        query: "expanded AI tools",
        answer: "Expansion evidence",
        results_count: 1,
        sources: [],
      },
      evidence: {
        evidence_source: "mock",
        opportunity_score: 0.82,
        commercial_intent: 0.8,
        content_potential: 0.84,
        referral_potential: 0.81,
        relevance: 0.83,
      },
      ...(value === undefined ? {} : { topic_expansion: value }),
      _meta: {
        dedupe_key: "runtime:expanded-topic:8303:content_draft",
      },
    },
  };

  assertContentJob(job);
  return job;
}

const provider: ContentProvider = async () => ({
  title: "Expanded AI Tool",
  body: "Expanded topic draft body",
  excerpt: "Expanded topic draft",
  meta_title: "Expanded AI Tool",
  meta_description: "Expanded topic description",
});

async function buildFixture(value?: unknown) {
  const sourceJob = createJob(value);
  const draft = await runContent(sourceJob, provider);
  const qaJob = buildQaJob(
    sourceJob,
    draft,
    {
      id: "00000000-0000-4000-8000-000000008306",
      slug: draft.slug,
      status: "draft",
    },
  );

  return { sourceJob, draft, qaJob };
}

Deno.test("preserves expanded-topic lineage in a QA job", async () => {
  const { draft, qaJob } = await buildFixture(topicExpansion);
  const draftExpansion = draft.evidence.topic_expansion as
    typeof topicExpansion | undefined;
  const qaExpansion = qaJob.payload.topic_expansion;

  assert(draftExpansion, "Draft evidence lost expansion lineage");
  assert(qaExpansion, "QA job lost expansion lineage");
  assert(
    qaExpansion.lineage.source_repeat_job_id ===
      draftExpansion.lineage.source_repeat_job_id,
    "QA job changed the source Repeat job id",
  );
  assert(
    qaExpansion.lineage.source_content_id ===
      draftExpansion.lineage.source_content_id,
    "QA job changed the source content id",
  );
  assert(
    qaExpansion.lineage.referral_link_id ===
      draftExpansion.lineage.referral_link_id,
    "QA job changed the referral link id",
  );
  assert(
    qaExpansion.lineage.execution_dedupe_key ===
      draftExpansion.lineage.execution_dedupe_key,
    "QA job changed the execution dedupe key",
  );
});

Deno.test("stores an isolated lineage object in a QA job", async () => {
  const { draft, qaJob } = await buildFixture(topicExpansion);
  const draftExpansion = draft.evidence.topic_expansion as
    typeof topicExpansion | undefined;
  const qaExpansion = qaJob.payload.topic_expansion;

  assert(draftExpansion, "Draft evidence lost expansion lineage");
  assert(qaExpansion, "QA job lost expansion lineage");
  assert(
    qaExpansion !== draftExpansion,
    "QA job reused the draft expansion object",
  );
  assert(
    qaExpansion.lineage !== draftExpansion.lineage,
    "QA job reused the draft lineage object",
  );
  assert(
    qaExpansion.safeguards !== draftExpansion.safeguards,
    "QA job reused the draft safeguards object",
  );
});

Deno.test("keeps ordinary QA jobs compatible", async () => {
  const { qaJob } = await buildFixture();

  assert(
    qaJob.payload.topic_expansion === undefined,
    "Ordinary QA job received expansion lineage",
  );
});

Deno.test("rejects invalid lineage before building a QA job", async () => {
  const sourceJob = createJob({
    ...topicExpansion,
    lineage: {
      ...topicExpansion.lineage,
      referral_link_id: "",
    },
  });
  let rejected = false;

  try {
    buildQaJob(
      sourceJob,
      {
        source_job_id: sourceJob.payload.source_job_id,
        request_id: sourceJob.payload.request_id,
        title: "Invalid expanded draft",
        slug: "invalid-expanded-draft-en",
        content_type: "article",
        language: "en",
        status: "draft",
        body: "Invalid",
        excerpt: "Invalid",
        meta_title: "Invalid",
        meta_description: "Invalid",
        evidence: {},
      },
      {
        id: "00000000-0000-4000-8000-000000008307",
        slug: "invalid-expanded-draft-en",
        status: "draft",
      },
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Invalid expansion lineage was accepted by QA");
});
