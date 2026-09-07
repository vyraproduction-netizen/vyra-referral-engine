import {
  authorizeWorkerRequest,
} from "../_shared/vyra/worker-auth.ts";

const names = [
  "RESEARCH_PROVIDER",
  "CONTENT_PROVIDER",
  "PUBLISH_PROVIDER",
  "TAVILY_API_KEY",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "VYRA_CONTROLLER_SECRET",
];

Deno.serve((request) => {
  const authorization = authorizeWorkerRequest(
    request,
    Deno.env.get("VYRA_WORKER_SECRET"),
  );

  if (!authorization.ok) {
    return Response.json(
      { ok: false, error: authorization.error },
      { status: authorization.status },
    );
  }

  const environment: Record<string, string> = {};

  for (const name of names) {
    environment[name] =
      Deno.env.get(name) ? "SET" : "MISSING";
  }

  return Response.json({
    ok: true,
    environment,
  });
});
