import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type TopicScoutPayload = {
  request_id: string;
  language: string;
  region: string;
  topic_seed: string;
  constraints?: {
    max_topics?: number;
    min_score?: number;
  };
};

type RunRequest = {
  action?: string;
  job_id?: string;
  payload?: TopicScoutPayload;
};

function isValidPayload(
  payload: unknown
): payload is TopicScoutPayload {
  if (!payload || typeof payload !== "object") return false;

  const value = payload as Record<string, unknown>;

  return (
    typeof value.request_id === "string" &&
    typeof value.language === "string" &&
    typeof value.region === "string" &&
    typeof value.topic_seed === "string"
  );
}

export default {
  async fetch(req: Request) {
    try {
      if (req.method !== "POST") {
        return Response.json(
          {
            ok: false,
            error: "POST required",
          },
          { status: 405 }
        );
      }

      const body = (await req.json()) as RunRequest;

      if (body.action !== "run") {
        return Response.json(
          {
            ok: false,
            error: "Invalid action",
            allowed_actions: ["run"],
          },
          { status: 400 }
        );
      }

      if (!body.job_id) {
        return Response.json(
          {
            ok: false,
            error: "job_id is required",
          },
          { status: 400 }
        );
      }

      if (!isValidPayload(body.payload)) {
        return Response.json(
          {
            ok: false,
            error: "Invalid payload",
            required: [
              "request_id",
              "language",
              "region",
              "topic_seed",
            ],
          },
          { status: 400 }
        );
      }

      const payload = body.payload;

      const maxTopics = Math.min(
        Math.max(payload.constraints?.max_topics ?? 10, 1),
        50
      );

      const minScore = Math.min(
        Math.max(payload.constraints?.min_score ?? 0.7, 0),
        1
      );

      // Interface-only stage:
      // no external AI calls, no DB writes, no publishing.
      const result = {
        request_id: payload.request_id,
        topics: [],
        meta: {
          language: payload.language,
          region: payload.region,
          topic_seed: payload.topic_seed,
          max_topics: maxTopics,
          min_score: minScore,
          stage: "interface_only",
        },
      };

      return Response.json({
        ok: true,
        agent: "topic_scout",
        job_id: body.job_id,
        request_id: payload.request_id,
        result,
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          agent: "topic_scout",
          error:
            error instanceof Error
              ? error.message
              : String(error),
        },
        { status: 500 }
      );
    }
  },
};
