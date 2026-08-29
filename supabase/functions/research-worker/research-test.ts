import {
  createResearchProvider,
  resolveResearchProviderName,
} from "./research-provider.ts";
import {
  assertResearchJob,
  runResearch,
} from "./research.ts";
import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("research provider defaults to Tavily", () => {
  assert(
    resolveResearchProviderName(undefined) === "tavily",
    "Missing provider must default to Tavily",
  );
});

Deno.test("research worker completes with explicit mock provider", async () => {
  const job: VyraJob = {
    id: "00000000-0000-4000-8000-000000000905",
    agent: "research",
    task_type: "topic_research",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id: "00000000-0000-4000-8000-000000000905",
      language: "ru",
      region: "EU",
      topic_seed: "image enhancement",
      candidate: {
        title: "Diagnostic candidate",
        url: "https://example.local/diagnostic-worker",
        opportunity_score: 0.8,
        commercial_intent: 0.8,
        content_potential: 0.8,
        referral_potential: 0.8,
        relevance: 0.8,
        evidence_source: "local-diagnostic",
      },
      recommended_action: "investigate_referral_program",
    },
  };

  assertResearchJob(job);

  const providerName = resolveResearchProviderName("mock");
  const result = await runResearch(
    job,
    createResearchProvider(providerName),
  );

  assert(result.research.results_count === 1, "Expected one mock result");
  assert(result.research.answer !== null, "Expected a mock answer");
  assert(result.candidate_url === job.payload.candidate.url, "URL mismatch");
});
