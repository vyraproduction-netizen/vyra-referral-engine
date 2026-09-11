import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.112.4";
import { createSupabaseAdminClient } from "../_shared/vyra/supabase-job-store.ts";
import type { TopicExpansionSource } from "./topic-expansion.ts";

type SourceRow = {
  id: unknown;
  title: unknown;
  language: unknown;
  status: unknown;
  evidence: unknown;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Topic expansion source ${field} is invalid`);
  }

  return value.trim();
}

function normalizeSourceRow(row: SourceRow): TopicExpansionSource {
  if (!isRecord(row.evidence)) {
    throw new Error("Topic expansion source evidence is invalid");
  }

  return {
    id: requiredString(row.id, "id"),
    title: requiredString(row.title, "title"),
    language: requiredString(row.language, "language"),
    status: requiredString(row.status, "status"),
    evidence: row.evidence,
  };
}

export async function loadTopicExpansionSource(
  client: SupabaseClient,
  contentId: string,
): Promise<TopicExpansionSource> {
  const normalizedId = contentId.trim();

  if (!normalizedId) {
    throw new Error("Topic expansion source content id is required");
  }

  const { data, error } = await client
    .from("content")
    .select("id, title, language, status, evidence")
    .eq("id", normalizedId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Topic expansion source load failed: ${error.message}`,
    );
  }

  if (!data) {
    throw new Error("Topic expansion source content was not found");
  }

  return normalizeSourceRow(data as unknown as SourceRow);
}

export function createTopicExpansionSourceLoader(): (
  contentId: string,
) => Promise<TopicExpansionSource> {
  const client = createSupabaseAdminClient();

  return async (contentId: string) =>
    await loadTopicExpansionSource(client, contentId);
}
