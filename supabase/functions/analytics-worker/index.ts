import {
  claimAnalyticsJob,
  completeAnalyticsJob,
  loadAnalyticsEvents,
  loadReferralLinkIds,
  retryAnalyticsJob,
  saveReferralMetrics,
} from "./db.ts";
import {
  assertAnalyticsJob,
} from "./analytics-job.ts";
import {
  rollupReferralEvents,
} from "./analytics.ts";

Deno.serve(async () => {
  let job = null;

  try {
    job = await claimAnalyticsJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        message: "No Analytics job available",
      });
    }

    assertAnalyticsJob(job);

    const referralLinkIds =
      await loadReferralLinkIds();
    const events = await loadAnalyticsEvents();
    const metrics = rollupReferralEvents(
      events,
      referralLinkIds,
    );

    await saveReferralMetrics(metrics);

    const result = {
      scope: job.payload.scope,
      links_processed: metrics.length,
      events_processed: events.length,
      clicks: metrics.reduce(
        (total, item) => total + item.clicks,
        0,
      ),
      conversions: metrics.reduce(
        (total, item) => total + item.conversions,
        0,
      ),
      revenue: Number(
        metrics
          .reduce(
            (total, item) => total + item.revenue,
            0,
          )
          .toFixed(2),
      ),
    };

    await completeAnalyticsJob(job.id, result);

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      analytics: result,
    });
  } catch (error) {
    if (job?.id) {
      await retryAnalyticsJob(
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
