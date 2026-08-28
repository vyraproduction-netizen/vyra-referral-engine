import { createClient } from "jsr:@supabase/supabase-js@2";

import type {
  JobInsertRow,
} from "./db-writer.ts";

export type InsertedJob = {
  id: string;
  dedupe_key: string;
};

export async function insertResearchJobs(
  rows: JobInsertRow[],
): Promise<InsertedJob[]> {
  if (rows.length === 0) {
    return [];
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  const supabaseKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
    Deno.env.get("SUPABASE_SECRET_KEY");

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required");
  }

  if (!supabaseKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required",
    );
  }

  const supabase = createClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  const { data, error } = await supabase
    .from("jobs")
    .insert(rows)
    .select("id, payload");

  if (error) {
    throw new Error(
      `Research job insert failed: ${error.message}`,
    );
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    dedupe_key:
      row.payload?._meta?.dedupe_key ?? "",
  }));
}