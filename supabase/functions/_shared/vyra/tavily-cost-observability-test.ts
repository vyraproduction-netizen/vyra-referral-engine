import {
  buildTavilyCostObservationArgs,
  recordTavilyCostObservation,
} from "./cost-observability.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Tavily observation records metadata without inventing a price", async () => {
  const args = buildTavilyCostObservationArgs({
    jobId: "11111111-1111-4111-8111-111111111111",
    operation: "research_worker_search",
    metadata: { search_depth: "advanced", max_results: 5, results_count: 3 },
  });
  assert(args.p_provider === "tavily", "Tavily provider was not recorded");
  assert(args.p_total_tokens === null, "Tavily observation invented token usage");
  assert(args.p_estimated_eur_micros === null && args.p_actual_eur_micros === null, "Tavily observation invented a price");
  const recorded = await recordTavilyCostObservation(
    async () => ({ data: { id: "22222222-2222-4222-8222-222222222222", mode: "observe" }, error: null }),
    { jobId: "11111111-1111-4111-8111-111111111111", operation: "topic_scout_search", metadata: { search_depth: "basic" } },
  );
  assert(recorded.mode === "observe", "Observe mode was not preserved");
});