import { createResearchJobClient } from "../research-worker/db.ts";
import { runResearch } from "../research-worker/research.ts";
import { completeResearchJob } from "../research-worker/db.ts";

const JOB_ID =
  "af683b83-a7a7-488c-b39a-c72112c81e2c";

Deno.serve(async () => {
  try {
    const supabase = createResearchJobClient();

    const { data: job, error: fetchError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", JOB_ID)
      .eq("status", "running")
      .single();

    if (fetchError) {
      throw new Error(
        `Research job fetch failed: ${fetchError.message}`,
      );
    }

    if (!job) {
      throw new Error(
        "Target Airbrush job is not running",
      );
    }

    const researchResult = await runResearch(job);

    const completion = await completeResearchJob(
      job.id,
      researchResult,
    );

    return Response.json({
      ok: true,
      job_id: job.id,
      candidate_url:
        job.payload?.candidate?.url ?? null,
      attempts: job.attempts,
      research: {
        results_count:
          researchResult.research.results_count,
        answer_present:
          Boolean(researchResult.research.answer),
      },
      completion,
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 },
    );
  }
});