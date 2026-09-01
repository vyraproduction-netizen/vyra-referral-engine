import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "npm:@supabase/server@1.4.1";
import {
  createAdminClient,
} from "npm:@supabase/server@1.4.1/core";
import {
  prepareProgramActivation,
} from "./program-activation.ts";
import type {
  ProgramActivationInput,
} from "./program-activation.ts";

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
      activate_program: {
        Args: {
          p_program_id: string;
          p_affiliate_url: string;
          p_terms_url: string;
          p_commission_type: string;
          p_commission_value: number;
          p_recurring: boolean;
          p_cookie_duration_days: number;
          p_countries: string[];
          p_verified_by: string;
          p_verification_note: string | null;
        };
        Returns: Record<string, unknown>;
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

const allowedActions = [
  "claim",
  "complete",
  "retry",
  "health",
  "dispatch",
  "activate_program",
] as const;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getSupabaseAdminSecret(): string {
  const adminSecret =
    Deno.env.get("SUPABASE_SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!adminSecret) {
    throw new Error(
      "A Supabase administrative key is required",
    );
  }

  return adminSecret;
}

function getSupabaseUrl(): string {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is required");
  }

  return supabaseUrl;
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
        default: getSupabaseAdminSecret(),
        vyra_controller: localSecret,
      },
    },
  };
}

const controllerAdmin =
  createAdminClient<ControllerDatabase>({
    env: {
      url: getSupabaseUrl(),
      secretKeys: {
        default: getSupabaseAdminSecret(),
      },
    },
  });

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

        if (!(allowedActions as readonly string[]).includes(action)) {
          return Response.json(
            {
              ok: false,
              error: "Invalid action",
              allowed_actions: [...allowedActions],
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

        if (action === "activate_program") {
          let activation;

          try {
            activation = prepareProgramActivation(
              body as unknown as ProgramActivationInput,
            );
          } catch (error) {
            return Response.json(
              {
                ok: false,
                action,
                error: getErrorMessage(error),
              },
              { status: 400 },
            );
          }

          const { data, error } =
            await controllerAdmin.rpc(
              "activate_program",
              {
                p_program_id: activation.program_id,
                p_affiliate_url:
                  activation.affiliate_url,
                p_terms_url: activation.terms_url,
                p_commission_type:
                  activation.commission_type,
                p_commission_value:
                  activation.commission_value,
                p_recurring: activation.recurring,
                p_cookie_duration_days:
                  activation.cookie_duration_days,
                p_countries: activation.countries,
                p_verified_by: activation.verified_by,
                p_verification_note:
                  activation.verification_note,
              },
            );

          if (error) {
            return Response.json(
              {
                ok: false,
                action,
                error: error.message,
              },
              { status: 400 },
            );
          }

          return Response.json({
            ok: true,
            action,
            activation: data,
          });
        }

        if (action === "dispatch") {
          const agent =
            typeof body.agent === "string" && body.agent.trim()
              ? body.agent.trim()
              : "topic_scout";
        if (agent === "research" || agent === "content" || agent === "qa" || agent === "publisher" || agent === "analytics") {
          const workerName = agent === "research"
            ? "research-worker"
            : agent === "content"
            ? "content-worker"
            : agent === "qa"
            ? "qa-worker"
            : agent === "publisher"
            ? "publisher-worker"
            : "analytics-worker";

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
			error: "Dispatch supports topic_scout, research, content, qa, publisher, and analytics only",
		  },
		{ status: 400 }
	  );
	}

          const { data, error } =
            await controllerAdmin.rpc("claim_next_job", {
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
              await controllerAdmin.rpc("complete_job", {
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
              await controllerAdmin.rpc("retry_job", {
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
            await controllerAdmin.rpc("claim_next_job", {
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
            await controllerAdmin.rpc("complete_job", {
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
            await controllerAdmin.rpc("retry_job", {
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
