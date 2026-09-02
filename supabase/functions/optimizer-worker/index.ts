import {
  claimOptimizerJob,
  completeOptimizerJob,
  loadOptimizationSnapshots,
  retryOptimizerJob,
} from "./db.ts";
import {
  assertOptimizerJob,
} from "./optimizer-job.ts";
import {
  rankOptimizationDecisions,
} from "./optimizer.ts";

Deno.serve(async () => {
  let job = null;

  try {
    job = await claimOptimizerJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        message: "No Optimizer job available",
      });
    }

    assertOptimizerJob(job);

    const snapshots = await loadOptimizationSnapshots();
    const decisions = rankOptimizationDecisions(snapshots);
    const result = {
      scope: job.payload.scope,
      snapshots_processed: snapshots.length,
      decisions,
      actions: {
        skip: decisions.filter((item) =>
          item.action === "skip"
        ).length,
        collect_more_data: decisions.filter((item) =>
          item.action === "collect_more_data"
        ).length,
        improve_content: decisions.filter((item) =>
          item.action === "improve_content"
        ).length,
        monitor: decisions.filter((item) =>
          item.action === "monitor"
        ).length,
        scale_content: decisions.filter((item) =>
          item.action === "scale_content"
        ).length,
      },
    };

    await completeOptimizerJob(job.id, result);

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      optimizer: result,
    });
  } catch (error) {
    if (job?.id) {
      await retryOptimizerJob(
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
