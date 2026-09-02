import type {
  ContentRevisionEnqueueResult,
} from "./content-revision-persistence.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";

type ContentRevisionEnqueuer = (
  plan: RepeatExecutionPlan,
) => Promise<ContentRevisionEnqueueResult>;

export type RepeatDownstreamResult =
  | {
    execution: "content_revision";
    content_revision: ContentRevisionEnqueueResult;
  }
  | {
    execution: "planned_only";
    content_revision: null;
  };

export async function routeRepeatDownstream(
  plan: RepeatExecutionPlan,
  enqueueContentRevision: ContentRevisionEnqueuer,
): Promise<RepeatDownstreamResult> {
  if (plan.action !== "improve_content") {
    return {
      execution: "planned_only",
      content_revision: null,
    };
  }

  return {
    execution: "content_revision",
    content_revision:
      await enqueueContentRevision(plan),
  };
}
