import {
  claimPublisherJob,
  completePublisherJob,
  loadContentForPublish,
  retryPublisherJob,
  savePublishResult,
} from "./db.ts";
import {
  createPublisherProvider,
} from "./publisher-provider.ts";
import {
  assertPublisherJob,
  runPublisher,
} from "./publisher.ts";
import type {
  PublishResult,
} from "./publisher.ts";

Deno.serve(async () => {
  let job = null;
  const providerName =
    Deno.env.get("PUBLISH_PROVIDER");

  try {
    const provider = createPublisherProvider(
      providerName,
    );

    job = await claimPublisherJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        provider: providerName,
        message: "No Publisher job available",
      });
    }

    assertPublisherJob(job);

    const content = await loadContentForPublish(
      job.payload.content_id,
    );

    const alreadyPublished =
      content.status === "published" &&
      Boolean(content.published_url);

    let result: PublishResult;
    let reused = false;

    if (alreadyPublished) {
      result = {
        content_id: content.id,
        slug: content.slug,
        published_url: content.published_url as string,
        provider: "stored",
      };
      reused = true;
    } else {
      result = await runPublisher(
        job,
        content,
        provider,
      );

      await savePublishResult(result);
    }

    await completePublisherJob(job.id, {
      ...result,
      reused,
    });

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      provider: result.provider,
      publication: result,
      reused,
    });
  } catch (error) {
    if (job?.id) {
      await retryPublisherJob(
        job.id,
        error instanceof Error
          ? error.message
          : String(error),
      );
    }

    return Response.json(
      {
        ok: false,
        provider: providerName ?? null,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 },
    );
  }
});
