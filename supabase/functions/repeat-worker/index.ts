import {
  claimRepeatJob,
  completeRepeatJob,
  createContentRevisionFromPlan,
  retryRepeatJob,
} from "./db.ts";
import {
  routeRepeatDownstream,
} from "./downstream.ts";
import {
  runRepeatJob,
} from "./repeat-job.ts";

Deno.serve(async () => {
  let job = null;

  try {
    job = await claimRepeatJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        message: "No Repeat job available",
      });
    }

    const planned = runRepeatJob(job);
    const downstream = await routeRepeatDownstream(
      planned.plan,
      createContentRevisionFromPlan,
    );
    const result = {
      ...planned,
      downstream,
    };

    await completeRepeatJob(job.id, result);

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      repeat: result,
    });
  } catch (error) {
    if (job?.id) {
      await retryRepeatJob(
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
