import {
  claimResearchJob,
  completeResearchJob,
  retryResearchJob,
} from "./db.ts";

import {
  assertResearchJob,
  runResearch,
} from "./research.ts";

Deno.serve(async () => {
  let job = null;

  try {
    job = await claimResearchJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        message: "No research job available",
      });
    }

    assertResearchJob(job);

    const researchResult = await runResearch(job);

    const completion = await completeResearchJob(
      job.id,
      researchResult,
    );

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      candidate_url:
        job.payload?.candidate?.url ?? null,
      research: {
        results_count:
          researchResult.research.results_count,
        answer_present:
          Boolean(researchResult.research.answer),
      },
      completion,
    });
  } catch (error) {
	if (job?.id) {
      await retryResearchJob(
        job.id,
        error instanceof Error
          ? error.message
          : String(error),
      );
    }
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