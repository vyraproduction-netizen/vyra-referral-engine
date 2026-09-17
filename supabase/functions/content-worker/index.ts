import {
  claimContentJob,
  completeContentJob,
  createContentQaJob,
  createContentRevisionQaJob,
  loadContentRevisionSource,
  retryContentJob,
  saveContentDraft,
  observeOpenAIContentUsage,
  saveContentRevision,
} from "./db.ts";
import {
  assertContentJob,
  runContent,
  type ContentDraft,
} from "./content.ts";
import type { ProviderUsage } from "./content-provider.ts";
import {
  createContentProvider,
  resolveContentProviderName,
} from "./content-provider.ts";
import {
  assertContentRevisionJob,
  type ContentRevisionDraft,
} from "./revision.ts";
import {
  runContentRevision,
} from "./revision-execution.ts";
import {
  authorizeWorkerRequest,
} from "../_shared/vyra/worker-auth.ts";
import {
  readPositiveEurMicros,
  runCostProtectedProviderCall,
} from "../_shared/vyra/cost-provider-checkpoint.ts";

const contentProviderName = resolveContentProviderName(
  Deno.env.get("CONTENT_PROVIDER"),
);
const contentProvider = createContentProvider(
  contentProviderName,
);

Deno.serve(async (request) => {
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
      const revisionJob = job;

      const source = await loadContentRevisionSource(
        job.payload.source_content_id,
      );
      let draft: ContentRevisionDraft;
      let costCheckpoint: {
        reservationId: string;
        reusedCheckpoint: boolean;
      } | null = null;

      if (contentProviderName === "openai") {
        const protectedCall =
          await runCostProtectedProviderCall({
            jobId: job.id,
            provider: "openai",
            operation: "content_revision",
            reservedEurMicros: readPositiveEurMicros(
              "VYRA_OPENAI_CONTENT_RESERVATION_EUR_MICROS",
            ),
            execute: () => runContentRevision(
              revisionJob,
              source,
              contentProvider,
            ),
            restore: (value) =>
              value as ContentRevisionDraft,
          });

        draft = protectedCall.result;
        costCheckpoint = {
          reservationId: protectedCall.reservationId,
          reusedCheckpoint: protectedCall.reusedCheckpoint,
        };
      } else {
        draft = await runContentRevision(
          job,
          source,
          contentProvider,
        );
      }

      const costObservation = contentProviderName === "openai"
        ? await observeOpenAIContentUsage(
          job.id,
          "content_revision",
          draft.evidence.generation_usage as ProviderUsage | undefined,
        )
        : null;
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
        cost_observation: costObservation,
		        cost_checkpoint: costCheckpoint
          ? {
            reservation_id: costCheckpoint.reservationId,
            reused: costCheckpoint.reusedCheckpoint,
          }
          : null,
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
	  const contentJob = job;

    let draft: ContentDraft;
    let costCheckpoint: {
      reservationId: string;
      reusedCheckpoint: boolean;
    } | null = null;

    if (contentProviderName === "openai") {
      const protectedCall =
        await runCostProtectedProviderCall({
          jobId: job.id,
          provider: "openai",
          operation: "content_draft",
          reservedEurMicros: readPositiveEurMicros(
            "VYRA_OPENAI_CONTENT_RESERVATION_EUR_MICROS",
          ),
          execute: () => runContent(
            contentJob,
            contentProvider,
          ),
          restore: (value) => value as ContentDraft,
        });

      draft = protectedCall.result;
      costCheckpoint = {
        reservationId: protectedCall.reservationId,
        reusedCheckpoint: protectedCall.reusedCheckpoint,
      };
    } else {
      draft = await runContent(
        job,
        contentProvider,
      );
    }

    const costObservation = contentProviderName === "openai"
      ? await observeOpenAIContentUsage(
        job.id,
        "content_draft",
        draft.evidence.generation_usage as ProviderUsage | undefined,
      )
      : null;
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
      cost_observation: costObservation,
	        cost_checkpoint: costCheckpoint
        ? {
          reservation_id: costCheckpoint.reservationId,
          reused: costCheckpoint.reusedCheckpoint,
        }
        : null,
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
