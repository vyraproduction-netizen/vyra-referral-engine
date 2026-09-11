import {
  buildOpenAICostObservationArgs,
  recordOpenAICostObservation,
} from "./cost-observability.ts";

Deno.test("OpenAI observation records the pinned native USD estimate", async () => {
  const args = buildOpenAICostObservationArgs({
    jobId: "00000000-0000-4000-8000-000000000901",
    operation: "content_draft",
    usage: { input_tokens: 1000, output_tokens: 2000, total_tokens: 3000 },
    model: "gpt-5-mini-2025-08-07",
  });

  if (args.p_provider !== "openai" || args.p_input_tokens !== 1000 ||
    args.p_output_tokens !== 2000 || args.p_total_tokens !== 3000 ||
    args.p_estimated_usd_micros !== 4250 || args.p_actual_usd_micros !== null ||
    args.p_pricing_version !== "openai-gpt-5-mini-standard-2026-09-10") {
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
