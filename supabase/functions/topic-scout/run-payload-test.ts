import {
  resolveTopicScoutPayload,
} from "./run-payload.ts";
import type {
  TopicExpansionSourceLoader,
} from "./run-payload.ts";
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

const source: TopicExpansionSource = {
  id: "00000000-0000-4000-8000-000000008203",
  title: "Image enhancement",
  language: "ru",
  status: "published",
  evidence: {
    topic_seed: "AI image upscaling",
    region: "EU",
  },
};

function expansionPayload(): TopicExpansionPayload {
  return {
    request_id: "00000000-0000-4000-8000-000000008201",
    source_repeat_job_id:
      "00000000-0000-4000-8000-000000008202",
    source_content_id: source.id,
    referral_link_id:
      "00000000-0000-4000-8000-000000008204",
    expansion: {
      action: "scale_content",
      reason: "Scale verified content",
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

async function errorMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }

  return "";
}

Deno.test("preserves a standard Topic Scout payload", async () => {
  let loadCount = 0;
  const payload = {
    request_id: "00000000-0000-4000-8000-000000008205",
    language: "en",
    region: "US",
    topic_seed: "video enhancement",
    constraints: { max_topics: 5, min_score: 0.8 },
  };

  const resolved = await resolveTopicScoutPayload(
    payload,
    async () => {
      loadCount += 1;
      return source;
    },
  );

  assert(resolved.payload === payload, "Standard payload was changed");
  assert(resolved.expansion === null, "Standard run marked as expansion");
  assert(loadCount === 0, "Standard run loaded source content");
});

Deno.test("resolves a topic expansion payload", async () => {
  const observedIds: string[] = [];
  const resolved = await resolveTopicScoutPayload(
    expansionPayload(),
    async (contentId) => {
      observedIds.push(contentId);
      return source;
    },
  );

  assert(observedIds.length === 1, "Source was not loaded exactly once");
  assert(observedIds[0] === source.id, "Wrong source content loaded");
  assert(resolved.payload.topic_seed === "AI image upscaling", "Topic lost");
  assert(resolved.payload.language === "ru", "Language lost");
  assert(resolved.payload.region === "EU", "Region lost");
  assert(resolved.expansion !== null, "Expansion metadata missing");
});

Deno.test("preserves expansion lineage in the resolved result", async () => {
  const resolved = await resolveTopicScoutPayload(
    expansionPayload(),
    async () => source,
  );

  assert(
    resolved.expansion?.lineage.source_content_id === source.id,
    "Source lineage mismatch",
  );
  assert(
    resolved.expansion?._meta.dedupe_key ===
      "repeat:scale:topic_expansion:execution",
    "Execution dedupe key mismatch",
  );
});

Deno.test("rejects an unsupported payload without loading content", async () => {
  let loadCount = 0;
  const loader: TopicExpansionSourceLoader = async () => {
    loadCount += 1;
    return source;
  };

  const message = await errorMessage(() =>
    resolveTopicScoutPayload({ request_id: "invalid" }, loader)
  );

  assert(message === "Invalid payload", "Invalid payload accepted");
  assert(loadCount === 0, "Invalid payload loaded source content");
});

Deno.test("propagates source loader failures", async () => {
  const message = await errorMessage(() =>
    resolveTopicScoutPayload(
      expansionPayload(),
      async () => {
        throw new Error("Topic expansion source content was not found");
      },
    )
  );

  assert(
    message === "Topic expansion source content was not found",
    "Source failure was hidden",
  );
});
