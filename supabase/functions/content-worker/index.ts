import {
  claimContentJob,
  completeContentJob,
  createContentQaJob,
  createContentRevisionQaJob,
  loadContentRevisionSource,
  retryContentJob,
  saveContentDraft,
  saveContentRevision,
} from "./db.ts";
import {
  assertContentJob,
  runContent,
} from "./content.ts";
import {
  createContentProvider,
  resolveContentProviderName,
} from "./content-provider.ts";
import {
  assertContentRevisionJob,
} from "./revision.ts";
import {
  runContentRevision,
} from "./revision-execution.ts";

const contentProviderName = resolveContentProviderName(
  Deno.env.get("CONTENT_PROVIDER"),
);
const contentProvider = createContentProvider(
  contentProviderName,
);

Deno.serve(async () => {
  let job = null;

  try {
    job = await claimContentJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        message: "No content job available",
      });
    }

    if (job.task_type === "content_revision") {
      assertContentRevisionJob(job);

      const source = await loadContentRevisionSource(
        job.payload.source_content_id,
      );
      const draft = await runContentRevision(
        job,
        source,
        contentProvider,
      );
      const revision = await saveContentRevision(
        job,
        draft,
      );
      const qaJob = await createContentRevisionQaJob(
        job,
        draft,
        revision,
      );

      const result = {
        content_id: revision.id,
        slug: revision.slug,
        status: revision.status,
        source_content_id:
          revision.source_content_id,
        revision_number: revision.revision_number,
        revision_job_id: revision.revision_job_id,
        created: revision.created,
        provider: contentProviderName,
        qa_job_id: qaJob?.id ?? null,
      };

      await completeContentJob(job.id, result);

      return Response.json({
        ok: true,
        claimed: true,
        job_id: job.id,
        provider: contentProviderName,
        revision,
        qa_job: qaJob,
      });
    }

    assertContentJob(job);

    const draft = await runContent(
      job,
      contentProvider,
    );

    const content = await saveContentDraft(draft);

    const qaJob = await createContentQaJob(
      job,
      draft,
      content,
    );

    const result = {
      content_id: content.id,
      slug: content.slug,
      status: content.status,
      created: content.created,
      provider: contentProviderName,
      qa_job_id: qaJob?.id ?? null,
    };

    await completeContentJob(job.id, result);

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      provider: contentProviderName,
      content,
      qa_job: qaJob,
    });
  } catch (error) {
    if (job?.id) {
      await retryContentJob(
        job.id,
        error instanceof Error
          ? error.message
          : String(error),
      );
    }

    return Response.json(
      {
        ok: false,
        provider: contentProviderName,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 },
    );
  }
});
