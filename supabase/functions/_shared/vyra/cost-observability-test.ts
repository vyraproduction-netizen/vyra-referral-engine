import {
  buildOpenAICostObservationArgs,
  recordOpenAICostObservation,
} from "./cost-observability.ts";

Deno.test("OpenAI observation records usage without inventing a price", async () => {
  const args = buildOpenAICostObservationArgs({
    jobId: "00000000-0000-4000-8000-000000000901",
    operation: "content_draft",
    usage: { input_tokens: 123, output_tokens: 45, total_tokens: 168 },
  });

  if (args.p_provider !== "openai" || args.p_input_tokens !== 123 ||
    args.p_output_tokens !== 45 || args.p_total_tokens !== 168 ||
    args.p_estimated_eur_micros !== null || args.p_actual_eur_micros !== null) {
    throw new Error("OpenAI observation arguments were incorrect");
  }

  const recorded = await recordOpenAICostObservation(async (received) => ({
    data: { id: "00000000-0000-4000-8000-000000000902", mode: "observe", received },
    error: null,
  }), {
    jobId: "00000000-0000-4000-8000-000000000901",
    operation: "content_draft",
  });

  if (recorded.mode !== "observe") {
    throw new Error("Observe mode was not preserved");
  }
});