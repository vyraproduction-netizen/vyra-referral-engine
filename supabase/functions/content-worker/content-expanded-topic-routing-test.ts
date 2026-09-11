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
      "00000000-0000-4000-8000-000000008200",
    source_content_id:
      "00000000-0000-4000-8000-000000008201",
    referral_link_id:
      "00000000-0000-4000-8000-000000008202",
    execution_dedupe_key:
      "runtime:expanded-topic:8200:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function createJob(value?: unknown): ContentJob {
  const job: VyraJob = {
    id: "00000000-0000-4000-8000-000000008203",
    agent: "content",
    task_type: "content_draft",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000008204",
      language: "en",
      region: "EU",
      topic_seed: "expanded AI tools",
      source_job_id: "00000000-0000-4000-8000-000000008205",
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
        dedupe_key: "runtime:expanded-topic:8203:content_draft",
      },
    },
  };

  assertContentJob(job);
  return job;
}

function createProvider(onCall?: () => void): ContentProvider {
  return async () => {
    onCall?.();

    return {
      title: "Expanded AI Tool",
      body: "Expanded topic draft body",
      excerpt: "Expanded topic draft",
      meta_title: "Expanded AI Tool",
      meta_description: "Expanded topic description",
    };
  };
}

Deno.test("preserves expanded-topic lineage in draft evidence", async () => {
  const draft = await runContent(
    createJob(topicExpansion),
    createProvider(),
  );
  const persisted = draft.evidence.topic_expansion as
    typeof topicExpansion | undefined;

  assert(persisted, "Draft evidence lost expansion lineage");
  assert(
    persisted.lineage.source_repeat_job_id ===
      topicExpansion.lineage.source_repeat_job_id,
    "Draft evidence changed the source Repeat job id",
  );
  assert(
    persisted.lineage.source_content_id ===
      topicExpansion.lineage.source_content_id,
    "Draft evidence changed the source content id",
  );
  assert(
    persisted.lineage.referral_link_id ===
      topicExpansion.lineage.referral_link_id,
    "Draft evidence changed the referral link id",
  );
  assert(
    persisted.lineage.execution_dedupe_key ===
      topicExpansion.lineage.execution_dedupe_key,
    "Draft evidence changed the execution dedupe key",
  );
});

Deno.test("stores an isolated lineage object in draft evidence", async () => {
  const draft = await runContent(
    createJob(topicExpansion),
    createProvider(),
  );
  const persisted = draft.evidence.topic_expansion as
    typeof topicExpansion | undefined;

  assert(persisted, "Draft evidence lost expansion lineage");
  assert(
    persisted !== topicExpansion,
    "Draft evidence reused the source expansion object",
  );
  assert(
    persisted.lineage !== topicExpansion.lineage,
    "Draft evidence reused the source lineage object",
  );
  assert(
    persisted.safeguards !== topicExpansion.safeguards,
    "Draft evidence reused the source safeguards object",
  );
});

Deno.test("keeps ordinary draft evidence unchanged", async () => {
  const draft = await runContent(
    createJob(),
    createProvider(),
  );

  assert(
    !("topic_expansion" in draft.evidence),
    "Ordinary draft received expansion evidence",
  );
});

Deno.test("rejects invalid expansion safeguards before generation", async () => {
  let providerCalled = false;
  let rejected = false;

  try {
    await runContent(
      createJob({
        ...topicExpansion,
        safeguards: {
          ...topicExpansion.safeguards,
          require_source_topic: false,
        },
      }),
      createProvider(() => {
        providerCalled = true;
      }),
    );
  } catch {
    rejected = true;
  }

  assert(rejected, "Invalid expansion safeguards were accepted");
  assert(
    !providerCalled,
    "Provider was called before expansion validation",
  );
});
