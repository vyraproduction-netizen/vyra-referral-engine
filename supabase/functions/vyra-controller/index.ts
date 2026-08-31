import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.4.1";

type ControllerJob = {
  id: string;
  payload: Record<string, unknown> | null;
};

type ControllerDatabase = {
  public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_next_job: {
        Args: {
          p_agent: string;
        };
        Returns: ControllerJob[];
      };
      complete_job: {
        Args: {
          p_job_id: string;
          p_status: string;
          p_result: object;
          p_error_message: string | null;
        };
        Returns: unknown;
      };
      retry_job: {
        Args: {
          p_job_id: string;
          p_error_message: string;
        };
        Returns: unknown;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

const allowedAgents = new Set([
  "topic_scout",
  "research",
  "content",
  "qa",
  "publisher",
  "analytics",
]);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getControllerAuthConfig() {
  const localSecret =
    Deno.env.get("VYRA_CONTROLLER_SECRET");

  if (!localSecret) {
    return {
      auth: "secret:vyra_controller" as const,
    };
  }

  return {
    auth: "secret:vyra_controller" as const,
    env: {
      secretKeys: {
        vyra_controller: localSecret,
      },
    },
  };
}

export default {
fetch: withSupabase<ControllerDatabase>(
    getControllerAuthConfig(),
    async (req, ctx) => {
      try {
        if (req.method !== "POST") {
          return Response.json(
            { ok: false, error: "POST required" },
            { status: 405 }
          );
        }

        let body: Record<string, unknown> = {};
        try {
          body = await req.json();
        } catch {
          body = {};
        }

        const action =
          typeof body.action === "string"
            ? body.action.trim().toLowerCase()
            : "claim";

        if (!["claim", "complete", "retry", "health", "dispatch"].includes(action)) {
          return Response.json(
            {
              ok: false,
              error: "Invalid action",
              allowed_actions: ["claim", "complete", "retry", "health", "dispatch"],
            },
            { status: 400 }
          );
        }

        if (action === "health") {
          return Response.json({
            ok: true,
            service: "vyra-controller",
            status: "online",
          });
        }

        if (action === "dispatch") {
          const agent =
            typeof body.agent === "string" && body.agent.trim()
              ? body.agent.trim()
              : "topic_scout";
        if (agent === "research" || agent === "content" || agent === "qa") {
          const workerName = agent === "research"
            ? "research-worker"
            : agent === "content"
            ? "content-worker"
            : "qa-worker";

          const supabaseUrl = Deno.env.get("SUPABASE_URL");

          if (!supabaseUrl) {
            return Response.json(
              { ok: false, error: "SUPABASE_URL is required" },
              { status: 500 }
            );
          }

          const workerResponse = await fetch(
            `${supabaseUrl}/functions/v1/${workerName}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: "{}",
            }
          );

          const workerData = await workerResponse.json();

          return Response.json(
            {
              action: "dispatch",
              agent,
              ...workerData,
            },
            { status: workerResponse.status }
          );
        }

        if (agent !== "topic_scout") {
		return Response.json(
		  {
			ok: false,
			error: "Dispatch supports topic_scout, research, content, and qa only",
		  },
		{ status: 400 }
	  );
	}

          const { data, error } =
            await ctx.supabaseAdmin.rpc("claim_next_job", {
              p_agent: agent,
            });

          if (error) {
            return Response.json(
              { ok: false, action, agent, error: error.message },
              { status: 500 }
            );
          }

          const job =
            Array.isArray(data) ? data[0] ?? null : data ?? null;

          if (!job) {
            return Response.json({
              ok: true,
              action,
              agent,
              claimed: false,
              message: "No topic_scout job available",
            });
          }

          try {
            const supabaseUrl = Deno.env.get("SUPABASE_URL");

            if (!supabaseUrl) {
              throw new Error("SUPABASE_URL is required");
            }

            const scoutResponse = await fetch(
              `${supabaseUrl}/functions/v1/topic-scout`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  action: "run",
                  job_id: job.id,
                  payload: job.payload,
                }),
              }
            );

            const scoutData = await scoutResponse.json();

            if (!scoutResponse.ok || !scoutData.ok) {
              throw new Error(
                scoutData.error ??
                  `topic-scout HTTP ${scoutResponse.status}`
              );
            }

            const { data: completed, error: completeError } =
              await ctx.supabaseAdmin.rpc("complete_job", {
                p_job_id: job.id,
                p_status: "completed",
                p_result: scoutData.result ?? scoutData,
                p_error_message: null,
              });

            if (completeError) {
              throw new Error(completeError.message);
            }

            return Response.json({
              ok: true,
              action,
              agent,
              claimed: true,
              job_id: job.id,
              scout: scoutData,
              completed,
            });
          } catch (error) {
            const message = getErrorMessage(error);

            const { data: retried, error: retryError } =
              await ctx.supabaseAdmin.rpc("retry_job", {
                p_job_id: job.id,
                p_error_message: message,
              });

            return Response.json(
              {
                ok: false,
                action,
                agent,
                job_id: job.id,
                error: message,
                retry_error: retryError?.message ?? null,
                retried: retried ?? null,
              },
              { status: 500 }
            );
          }
        }
        if (action === "claim") {
          const agent =
            typeof body.agent === "string" && body.agent.trim()
              ? body.agent.trim()
              : "topic_scout";

          if (!allowedAgents.has(agent)) {
            return Response.json(
              {
                ok: false,
                error: "Invalid agent",
                allowed_agents: [...allowedAgents],
              },
              { status: 400 }
            );
          }

          const { data, error } =
            await ctx.supabaseAdmin.rpc("claim_next_job", {
              p_agent: agent,
            });

          if (error) {
            return Response.json(
              { ok: false, action, agent, error: error.message },
              { status: 500 }
            );
          }

          const job =
            Array.isArray(data) ? data[0] ?? null : data ?? null;

          return Response.json({
            ok: true,
            action,
            agent,
            claimed: Boolean(job),
            job,
          });
        }

        if (action === "complete") {
          const jobId =
            typeof body.job_id === "string" ? body.job_id : null;

          if (!jobId) {
            return Response.json(
              { ok: false, error: "job_id is required" },
              { status: 400 }
            );
          }

          const result =
            body.result && typeof body.result === "object"
              ? body.result
              : {};

          const { data, error } =
            await ctx.supabaseAdmin.rpc("complete_job", {
              p_job_id: jobId,
              p_status: "completed",
              p_result: result,
              p_error_message: null,
            });

          if (error) {
            return Response.json(
              { ok: false, action, error: error.message },
              { status: 500 }
            );
          }

          return Response.json({
            ok: true,
            action,
            job: data,
          });
        }

        if (action === "retry") {
          const jobId =
            typeof body.job_id === "string" ? body.job_id : null;

          if (!jobId) {
            return Response.json(
              { ok: false, error: "job_id is required" },
              { status: 400 }
            );
          }

          const errorMessage =
            typeof body.error_message === "string"
              ? body.error_message
              : "Unknown job error";

          const { data, error } =
            await ctx.supabaseAdmin.rpc("retry_job", {
              p_job_id: jobId,
              p_error_message: errorMessage,
            });

          if (error) {
            return Response.json(
              { ok: false, action, error: error.message },
              { status: 500 }
            );
          }

          return Response.json({
            ok: true,
            action,
            job: data,
          });
        }

        return Response.json(
          { ok: false, error: "Unhandled action" },
          { status: 500 }
        );
      } catch (error) {
        return Response.json(
          { ok: false, error: getErrorMessage(error) },
          { status: 500 }
        );
      }
    }
  ),
};


