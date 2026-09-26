import type { PublisherJob } from "./publisher.ts";
import {
  resolvePublisherExpandedTopicLineage,
} from "./publisher-expanded-topic-lineage.ts";

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
    source_repeat_job_id: "00000000-0000-4000-8000-000000008600",
    source_content_id: "00000000-0000-4000-8000-000000008601",
    referral_link_id: "00000000-0000-4000-8000-000000008602",
    execution_dedupe_key: "runtime:expanded-topic:8600:execution",
  },
  safeguards: {
    preserve_source_content: true,
    require_source_topic: true,
    allow_duplicate_topics: false,
  },
};

function createJob(value?: unknown): PublisherJob {
  return {
    id: "00000000-0000-4000-8000-000000008603",
    agent: "publisher",
    task_type: "content_publish",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000008604",
      source_qa_job_id: "00000000-0000-4000-8000-000000008605",
      source_content_job_id: "00000000-0000-4000-8000-000000008606",
      source_research_job_id: "00000000-0000-4000-8000-000000008607",
      content_id: "00000000-0000-4000-8000-000000008608",
      language: "en",
      title: "Expanded topic Publisher fixture",
      slug: "expanded-topic-publisher-fixture",
      qa_score: 1,
      ...(value === undefined ? {} : { topic_expansion: value }),
      _meta: {
        dedupe_key: "00000000-0000-4000-8000-000000008608:content_publish",
      },
    },
  } as PublisherJob;
}

Deno.test("resolves expanded-topic lineage in Publisher", () => {
  const resolved = resolvePublisherExpandedTopicLineage(
    createJob(topicExpansion),
  );

  assert(resolved, "Expected expanded-topic lineage");
  assert(
    resolved.lineage.source_repeat_job_id ===
      topicExpansion.lineage.source_repeat_job_id,
    "Source Repeat job id changed",
  );
  assert(
    resolved.lineage.source_content_id ===
      topicExpansion.lineage.source_content_id,
    "Source content id changed",
  );
  assert(
    resolved.lineage.referral_link_id ===
      topicExpansion.lineage.referral_link_id,
    "Referral link id changed",
  );
  assert(
    resolved.lineage.execution_dedupe_key ===
      topicExpansion.lineage.execution_dedupe_key,
    "Execution dedupe key changed",
  );
});

Deno.test("returns an isolated Publisher lineage object", () => {
  const resolved = resolvePublisherExpandedTopicLineage(
    createJob(topicExpansion),
  );

  assert(resolved, "Expected expanded-topic lineage");
  assert(resolved !== topicExpansion, "Metadata object was reused");
  assert(
    resolved.lineage !== topicExpansion.lineage,
    "Lineage object was reused",
  );
  assert(
    resolved.safeguards !== topicExpansion.safeguards,
    "Safeguards object was reused",
  );
});

Deno.test("keeps ordinary Publisher jobs compatible", () => {
  assert(
    resolvePublisherExpandedTopicLineage(createJob()) === null,
    "Ordinary Publisher job received expansion lineage",
  );
});

for (
  const [name, value] of [
    ["metadata", null],
    ["lineage", { ...topicExpansion, lineage: null }],
    ["safeguards", { ...topicExpansion, safeguards: null }],
    [
      "source Repeat job id",
      {
        ...topicExpansion,
        lineage: {
          ...topicExpansion.lineage,
          source_repeat_job_id: "",
        },
      },
    ],
    [
      "source content id",
      {
        ...topicExpansion,
        lineage: {
          ...topicExpansion.lineage,
          source_content_id: "",
        },
      },
    ],
    [
      "referral link id",
      {
        ...topicExpansion,
        lineage: {
          ...topicExpansion.lineage,
          referral_link_id: "",
        },
      },
    ],
    [
      "execution dedupe key",
      {
        ...topicExpansion,
        lineage: {
          ...topicExpansion.lineage,
          execution_dedupe_key: "",
        },
      },
    ],
    [
      "safeguard values",
      {
        ...topicExpansion,
        safeguards: {
          ...topicExpansion.safeguards,
          allow_duplicate_topics: true,
        },
      },
    ],
  ] as const
) {
  Deno.test(`rejects invalid Publisher ${name}`, () => {
    let rejected = false;

    try {
      resolvePublisherExpandedTopicLineage(createJob(value));
    } catch {
      rejected = true;
    }

    assert(rejected, `Invalid Publisher ${name} was accepted`);
  });
}
