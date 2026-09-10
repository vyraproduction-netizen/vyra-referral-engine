import type { ProviderUsage } from "../../content-worker/content-provider.ts";

export type CostObservationRpc = (args: Record<string, unknown>) => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

export type OpenAICostObservation = {
  jobId: string;
  operation: string;
  usage?: ProviderUsage;
};

export type RecordedCostObservation = {
  id: string;
  mode: "observe" | "enforce";
};

export function buildOpenAICostObservationArgs(
  observation: OpenAICostObservation,
): Record<string, unknown> {
  return {
    p_job_id: observation.jobId,
    p_provider: "openai",
    p_operation: observation.operation,
    p_input_tokens: observation.usage?.input_tokens ?? null,
    p_output_tokens: observation.usage?.output_tokens ?? null,
    p_total_tokens: observation.usage?.total_tokens ?? null,
    p_estimated_eur_micros: null,
    p_actual_eur_micros: null,
    p_pricing_version: null,
    p_metadata: {
      source: "openai_responses",
      usage_available: Boolean(observation.usage),
    },
  };
}

export async function recordOpenAICostObservation(
  callRpc: CostObservationRpc,
  observation: OpenAICostObservation,
): Promise<RecordedCostObservation> {
  const { data, error } = await callRpc(
    buildOpenAICostObservationArgs(observation),
  );

  if (error) {
    throw new Error(`Cost observation failed: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Cost observation returned an invalid response");
  }

  const row = data as { id?: unknown; mode?: unknown };
  if (typeof row.id !== "string" || (row.mode !== "observe" && row.mode !== "enforce")) {
    throw new Error("Cost observation returned incomplete fields");
  }

  return { id: row.id, mode: row.mode };
}