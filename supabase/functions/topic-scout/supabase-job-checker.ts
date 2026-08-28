import { createClient } from "jsr:@supabase/supabase-js@2";

export function createSupabaseJobChecker() {
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

  return async (dedupeKey: string): Promise<boolean> => {
    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .contains("payload", {
        _meta: {
          dedupe_key: dedupeKey,
        },
      })
      .limit(1);

    if (error) {
      throw new Error(
        `Job dedupe check failed: ${error.message}`,
      );
    }

    return (data?.length ?? 0) > 0;
  };
}