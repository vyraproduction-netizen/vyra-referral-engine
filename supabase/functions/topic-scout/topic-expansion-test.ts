import {
  buildTopicExpansionExecution,
} from "./topic-expansion.ts";
import type {
  TopicExpansionPayload,
  TopicExpansionSource,
} from "./topic-expansion.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function payload(): TopicExpansionPayload {
  return {
    request_id: "00000000-0000-4000-8000-000000008001",
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000008002",
    source_content_id:
      "00000000-0000-4000-8000-000000008003",
    referral_link_id:
      "00000000-0000-4000-8000-000000008004",
    expansion: {
      action: "scale_content",
      reason: "Scale the verified topic",
      priority: 60,
      metrics: {
        clicks: 100,
        conversions: 5,
        revenue: 25,
        conversion_rate: 0.05,
      },
    },
    safeguards: {
      preserve_source_content: true,
      require_source_topic: true,
      allow_duplicate_topics: false,
    },
    _meta: {
      dedupe_key: "repeat:scale:topic_expansion",
    },
  };
}

function source(): TopicExpansionSource {
  return {
    id: "00000000-0000-4000-8000-000000008003",
    title: "Image enhancement",
    language: "ru",
    status: "published",
    evidence: {
      topic_seed: "AI image upscaling",
      region: "EU",
    },
  };
}

function errorMessage(run: () => void): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }

  return "";
}

Deno.test("builds a deterministic topic expansion execution", () => {
  const first = buildTopicExpansionExecution(payload(), source());
  const second = buildTopicExpansionExecution(payload(), source());

  assert(
    JSON.stringify(first) === JSON.stringify(second),
    "Topic expansion execution changed",
  );
  assert(first.topic_seed === "AI image upscaling", "Topic mismatch");
  assert(first.language === "ru", "Language mismatch");
  assert(first.region === "EU", "Region mismatch");
});

Deno.test("preserves topic expansion lineage and safeguards", () => {
  const value = buildTopicExpansionExecution(payload(), source());

  assert(
    value.lineage.source_repeat_job_id ===
      payload().source_repeat_job_id,
    "Repeat lineage mismatch",
  );
  assert(
    value.lineage.source_content_id === payload().source_content_id,
    "Content lineage mismatch",
  );
  assert(
    value.lineage.referral_link_id === payload().referral_link_id,
    "Referral lineage mismatch",
  );
  assert(value.safeguards.preserve_source_content, "Source not protected");
  assert(!value.safeguards.allow_duplicate_topics, "Duplicates allowed");
});

Deno.test("falls back to source title and global region", () => {
  const value = buildTopicExpansionExecution(
    payload(),
    { ...source(), evidence: {} },
  );

  assert(value.topic_seed === "Image enhancement", "Title not used");
  assert(value.region === "global", "Region fallback mismatch");
});

Deno.test("reads nested source evidence", () => {
  const value = buildTopicExpansionExecution(
    payload(),
    {
      ...source(),
      evidence: {
        source: {
          topic_seed: "Photo restoration",
          region: "US",
        },
      },
    },
  );

  assert(value.topic_seed === "Photo restoration", "Nested topic lost");
  assert(value.region === "US", "Nested region lost");
});

Deno.test("rejects a mismatched source content", () => {
  const invalid = source();
  invalid.id = "00000000-0000-4000-8000-000000008099";

  assert(
    errorMessage(() => buildTopicExpansionExecution(payload(), invalid)) ===
      "Topic expansion source content mismatch",
    "Foreign source content accepted",
  );
});

Deno.test("rejects an unpublished source content", () => {
  const invalid = source();
  invalid.status = "draft";

  assert(
    errorMessage(() => buildTopicExpansionExecution(payload(), invalid)) ===
      "Topic expansion source content must be published",
    "Unpublished source content accepted",
  );
});

Deno.test("rejects invalid safeguards", () => {
  const invalid = payload();
  invalid.safeguards.allow_duplicate_topics = true as false;

  assert(
    errorMessage(() => buildTopicExpansionExecution(invalid, source())) ===
      "Topic expansion safeguards are invalid",
    "Unsafe expansion accepted",
  );
});

Deno.test("builds a stable execution dedupe key", () => {
  const value = buildTopicExpansionExecution(payload(), source());

  assert(
    value._meta.dedupe_key ===
      "repeat:scale:topic_expansion:execution",
    "Execution dedupe key mismatch",
  );
});
