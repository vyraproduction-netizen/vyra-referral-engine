import {
  claimQaJob,
  completeQaJob,
  createQaPublishJob,
  loadContentForQa,
  retryQaJob,
  saveQaResult,
} from "./db.ts";
import {
  assertQaJob,
  evaluateContent,
} from "./qa.ts";
import type {
  QaResult,
} from "./qa.ts";

Deno.serve(async () => {
  let job = null;

  try {
    job = await claimQaJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        message: "No QA job available",
      });
    }

    assertQaJob(job);

    const content = await loadContentForQa(
      job.payload.content_id,
    );

    if (content.id !== job.payload.content_id) {
      throw new Error("QA content id mismatch");
    }

    if (content.slug !== job.payload.slug) {
      throw new Error("QA content slug mismatch");
    }

    const storedScore = Number(content.qa_score);
    const hasStoredScore =
      content.qa_score !== null &&
      content.qa_score !== "" &&
      Number.isFinite(storedScore);
    const alreadyProcessed =
      (
        content.status === "approved" ||
        content.status === "rejected"
      ) && hasStoredScore;

    let result: QaResult;
    let reused = false;

    if (alreadyProcessed) {
      result = {
        content_id: content.id,
        score: storedScore,
        status: content.status as
          | "approved"
          | "rejected",
        checks: [],
      };
      reused = true;
    } else {
      result = evaluateContent(content);
      await saveQaResult(result);
    }

    const publishJob = await createQaPublishJob(
      job,
      result,
    );

    await completeQaJob(job.id, {
      ...result,
      reused,
      publish_job_id: publishJob?.id ?? null,
    });

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      qa: result,
      reused,
      publish_job: publishJob,
    });
  } catch (error) {
    if (job?.id) {
      await retryQaJob(
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
