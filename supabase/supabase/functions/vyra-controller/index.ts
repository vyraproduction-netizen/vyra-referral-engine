import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "jsr:@supabase/server";

export default {
  fetch: withSupabase(
    { auth: "secret:vyra_worker" },
    async (_req, ctx) => {
      try {
        const { data, error } = await ctx.supabaseAdmin
          .from("jobs")
          .select("id, agent, task_type, status, priority, attempts")
          .eq("status", "queued")
          .order("priority", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(10);

        if (error) {
          return Response.json(
            {
              ok: false,
              error: error.message
            },
            { status: 500 }
          );
        }

        return Response.json({
          ok: true,
          queued_jobs: data,
          count: data.length
        });
      } catch (error) {
        return Response.json(
          {
            ok: false,
            error: error instanceof Error
              ? error.message
              : String(error)
          },
          { status: 500 }
        );
      }
    }
  )
};
