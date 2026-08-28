import { createSupabaseJobStore } from "../_shared/vyra/supabase-job-store.ts";

export function createSupabaseJobChecker() {
  const store = createSupabaseJobStore();

  return async (dedupeKey: string): Promise<boolean> => {
    return await store.existsByDedupeKey(dedupeKey);
  };
}
