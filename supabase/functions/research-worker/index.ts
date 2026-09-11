import {
  claimResearchJob,
  completeResearchJob,
  createResearchContentJob,
  retryResearchJob,
  saveResearchProgramCandidate,
  saveResearchReferralLink,
  observeTavilyResearchUsage,
} from "./db.ts";

import {
  createResearchProvider,
  resolveResearchProviderName,
} from "./research-provider.ts";
import {
  assertResearchJob,
  runResearch,
} from "./research.ts";
import {
  resolveResearchExpandedTopicLineage,
} from "./research-expanded-topic-lineage.ts";
import {
  authorizeWorkerRequest,
} from "../_shared/vyra/worker-auth.ts";

const researchProviderName = resolveResearchProviderName(
  Deno.env.get("RESEARCH_PROVIDER"),
);
const researchProvider = createResearchProvider(
  researchProviderName,
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
    job = await claimResearchJob();

    if (!job) {
      return Response.json({
        ok: true,
        claimed: false,
        message: "No research job available",
      });
    }

    assertResearchJob(job);

    const topicExpansion =
      resolveResearchExpandedTopicLineage(job);

    const researchResult = await runResearch(
      job,
      researchProvider,
    );

    const costObservation = researchProviderName === "tavily"
      ? await observeTavilyResearchUsage(job.id, {
        search_depth: "advanced",
        max_results: 5,
        include_answer: true,
        results_count: researchResult.research.results_count,
      })
      : null;

    const program =
      await saveResearchProgramCandidate(
        job,
        researchResult,
      );

    const referralLink =
      await saveResearchReferralLink(program);

    const contentJob = await createResearchContentJob(
      job,
      researchResult,
      topicExpansion,
    );

    const completion = await completeResearchJob(
      job.id,
      {
        ...researchResult,
        program,
        referral_link: referralLink,
        ...(costObservation ? { cost_observation: costObservation } : {}),
        ...(topicExpansion
          ? { topic_expansion: topicExpansion }
          : {}),
      },
    );

    return Response.json({
      ok: true,
      claimed: true,
      job_id: job.id,
      provider: researchProviderName,
      candidate_url:
        job.payload.candidate.url,
      research: {
        results_count:
          researchResult.research.results_count,
        answer_present:
          Boolean(researchResult.research.answer),
      },
      program,
      referral_link: referralLink,
      content_job: contentJob,
      topic_expansion: topicExpansion,
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
        provider: researchProviderName,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      },
      { status: 500 },
    );
  }
});
