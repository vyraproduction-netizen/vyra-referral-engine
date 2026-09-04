import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { LocalMockResearchProvider } from "./mock-research.ts";
import { TavilyResearchProvider } from "./tavily-research.ts";
import { normalizeResearch } from "./research-normalizer.ts";
import { scoreResearch } from "./research-scoring.ts";
import { selectTopOpportunities } from "./opportunity-selector.ts";
import { buildScoutOpportunities } from "./scout-opportunity.ts";
import { buildResearchJob } from "./research-job.ts";
import { prepareResearchJobs } from "./job-writer.ts";
import { prepareJobInsert } from "./db-writer.ts";
import { createSupabaseJobChecker } from "./supabase-job-checker.ts";
import { filterNewResearchJobs } from "./job-dedupe.ts";
import { insertResearchJobs } from "./job-inserter.ts";
import { resolveTopicScoutPayload } from "./run-payload.ts";
import { createTopicExpansionSourceLoader } from "./topic-expansion-source.ts";

const researchProviderType =
  Deno.env.get("RESEARCH_PROVIDER") ?? "mock";

function createResearchProvider() {
  if (researchProviderType === "tavily") {
    const apiKey = Deno.env.get("TAVILY_API_KEY");

    if (!apiKey) {
      throw new Error(
        "TAVILY_API_KEY is required when RESEARCH_PROVIDER=tavily",
      );
    }

    return new TavilyResearchProvider(apiKey);
  }

  return new LocalMockResearchProvider();
}

const researchProvider = createResearchProvider();
type RunRequest = {
  action?: string;
  job_id?: string;
  payload?: unknown;
};

type TopicCandidate = {
  topic: string;
  keywords: string[];
  score: number;
  reason: string;
};

const TOPIC_LIBRARY: Record<string, string[]> = {
  "image enhancement": [
    "AI image upscaling",
    "image quality enhancement",
    "photo enhancement with AI",
    "4K image upscaling",
    "old photo restoration",
    "image sharpening with AI",
    "blurry photo enhancement",
    "AI photo restoration",
    "low resolution image enhancement",
    "image noise reduction",
  ],

  "video enhancement": [
    "AI video upscaling",
    "video quality enhancement",
    "4K video enhancement",
    "old video restoration",
    "video denoising with AI",
    "frame interpolation",
    "video sharpening",
    "low resolution video enhancement",
    "AI video restoration",
    "video stabilization with AI",
  ],

  "3d": [
    "image to 3D conversion",
    "photo to 3D model",
    "AI 3D reconstruction",
    "2D to 3D conversion",
    "single image 3D generation",
    "AI 3D asset generation",
    "3D model from photo",
    "AI mesh generation",
  ],
};

const KEYWORD_LIBRARY: Record<string, string[]> = {
  "AI image upscaling": [
    "ai image upscaler",
    "image upscaler",
    "enhance image quality",
    "4k image",
  ],

  "image quality enhancement": [
    "improve image quality",
    "image enhancer",
    "photo enhancer",
    "enhance photo",
  ],

  "photo enhancement with AI": [
    "ai photo enhancer",
    "photo enhancement",
    "enhance photo with ai",
    "ai image enhancer",
  ],

  "4K image upscaling": [
    "4k image upscaler",
    "upscale image to 4k",
    "ai 4k upscaler",
  ],

  "old photo restoration": [
    "restore old photos",
    "old photo restoration",
    "ai photo restoration",
    "repair old photo",
  ],
};

function normalize(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function titleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => {
      if (!part) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function scoreTopic(
  topic: string,
  seed: string,
): { score: number; reason: string } {
  const normalizedTopic = normalize(topic);
  const normalizedSeed = normalize(seed);

  let score = 0.60;
  const reasons: string[] = [];

  if (
    normalizedTopic.includes(normalizedSeed) ||
    normalizedSeed.includes(normalizedTopic)
  ) {
    score += 0.18;
    reasons.push("strong seed relevance");
  }

  if (/(ai|artificial intelligence)/i.test(topic)) {
    score += 0.05;
    reasons.push("AI intent");
  }

  if (/(4k|3d|upscal|restor|enhanc|generat)/i.test(topic)) {
    score += 0.05;
    reasons.push("clear transformation intent");
  }

  if (topic.length >= 12 && topic.length <= 60) {
    score += 0.03;
    reasons.push("usable topic length");
  }

  return {
    score: Math.min(Number(score.toFixed(2)), 0.99),
    reason: reasons.length > 0
      ? reasons.join("; ")
      : "baseline relevance",
  };
}

function buildCandidates(seed: string): TopicCandidate[] {
  const normalizedSeed = normalize(seed);

  let rawTopics = TOPIC_LIBRARY[normalizedSeed] ?? [];

  if (rawTopics.length === 0) {
    rawTopics = [
      `${titleCase(seed)} with AI`,
      `AI tools for ${seed}`,
      `${titleCase(seed)} enhancement`,
      `${titleCase(seed)} automation`,
      `how to improve ${seed}`,
    ];
  }

  return rawTopics
    .map((topic) => {
      const scoring = scoreTopic(topic, seed);

      return {
        topic,
        keywords: KEYWORD_LIBRARY[topic] ?? [
          normalize(topic),
          `${normalize(seed)} ai`,
          `best ${normalize(topic)}`,
        ],
        score: scoring.score,
        reason: scoring.reason,
      };
    })
    .sort((a, b) => b.score - a.score);
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method !== "POST") {
      return Response.json(
        {
          ok: false,
          error: "POST required",
        },
        { status: 405 },
      );
    }

    const body = (await req.json()) as RunRequest;

    if (body.action !== "run") {
      return Response.json(
        {
          ok: false,
          error: "Invalid action",
          allowed_actions: ["run"],
        },
        { status: 400 },
      );
    }

    if (!body.job_id) {
      return Response.json(
        {
          ok: false,
          error: "job_id is required",
        },
        { status: 400 },
      );
    }

    let resolvedPayload;

    try {
      resolvedPayload = await resolveTopicScoutPayload(
        body.payload,
        async (contentId) =>
          await createTopicExpansionSourceLoader()(contentId),
      );
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error
            ? error.message
            : String(error),
        },
        { status: 400 },
      );
    }

    const payload = resolvedPayload.payload;
	const researchResults = await researchProvider.search({
  query: payload.topic_seed,
  language: payload.language,
  region: payload.region,
  max_results: payload.constraints?.max_topics ?? 10,
});

const normalizedResearch = normalizeResearch(researchResults);

const scoredResearch = scoreResearch(
  normalizedResearch,
  payload.topic_seed,
);

const opportunities = selectTopOpportunities(
  scoredResearch,
  3,
);

const scoutOpportunities = buildScoutOpportunities(
  opportunities,
  payload.topic_seed,
);

const researchJobs = scoutOpportunities
  .map((opportunity) =>
    buildResearchJob(
      opportunity,
      payload.request_id,
      payload.language,
      payload.region,
    )
  );

const preparedResearchJobs = prepareResearchJobs(
  researchJobs,
);

const checkExistingJob = createSupabaseJobChecker();

const newResearchJobs = await filterNewResearchJobs(
  preparedResearchJobs,
  checkExistingJob,
);

const jobInsertRows = newResearchJobs.map(
  (item) =>
    prepareJobInsert(
      item.job,
      item.dedupe_key,
    ),
);

const insertedResearchJobs = await insertResearchJobs(
  jobInsertRows,
);

    const maxTopics = Math.min(
      Math.max(payload.constraints?.max_topics ?? 10, 1),
      50,
    );

    const minScore = Math.min(
      Math.max(payload.constraints?.min_score ?? 0.7, 0),
      1,
    );

    const candidates = buildCandidates(payload.topic_seed);

    const topics = candidates
      .filter((candidate) => candidate.score >= minScore)
      .slice(0, maxTopics);

    return Response.json({
      ok: true,
      agent: "topic_scout",
      job_id: body.job_id,
      request_id: payload.request_id,
result: {
  request_id: payload.request_id,
  ...(resolvedPayload.expansion
    ? { topic_expansion: resolvedPayload.expansion }
    : {}),
  topics,
  research: scoredResearch,
  opportunities,
  scout_opportunities: scoutOpportunities,
  research_jobs: preparedResearchJobs,
  new_research_jobs: newResearchJobs,
  job_insert_rows: jobInsertRows,
  inserted_research_jobs: insertedResearchJobs,
  meta: {
    language: payload.language,
    region: payload.region,
    topic_seed: payload.topic_seed,
    max_topics: maxTopics,
    min_score: minScore,
    stage: "deterministic_prototype",
    source: "local_topic_library",
    research_provider: researchProviderType,
	scoring: "heuristic_v1",
	opportunity_selection: "top3_domain_diverse_v1",
	scout_decision: "referral_first_v1",
  },
},
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        agent: "topic_scout",
        error: error instanceof Error
          ? error.message
          : String(error),
      },
      { status: 500 },
    );
  }
});
