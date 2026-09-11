import type {
  ContentRevisionEnqueueResult,
} from "./content-revision-persistence.ts";
import type {
  RepeatExecutionPlan,
} from "./plan.ts";
import type {
  TopicExpansionEnqueueResult,
} from "./topic-expansion-persistence.ts";

type ContentRevisionEnqueuer = (
  plan: RepeatExecutionPlan,
) => Promise<ContentRevisionEnqueueResult>;

type TopicExpansionEnqueuer = (
  plan: RepeatExecutionPlan,
) => Promise<TopicExpansionEnqueueResult>;

export type RepeatDownstreamResult =
  | {
    execution: "content_revision";
    content_revision: ContentRevisionEnqueueResult;
    topic_expansion: null;
  }
  | {
    execution: "topic_expansion";
    content_revision: null;
    topic_expansion: TopicExpansionEnqueueResult;
  };

export async function routeRepeatDownstream(
  plan: RepeatExecutionPlan,
  enqueueContentRevision: ContentRevisionEnqueuer,
  enqueueTopicExpansion: TopicExpansionEnqueuer,
): Promise<RepeatDownstreamResult> {
  if (plan.action === "scale_content") {
    return {
      execution: "topic_expansion",
      content_revision: null,
      topic_expansion:
        await enqueueTopicExpansion(plan),
    };
  }

  return {
    execution: "content_revision",
    content_revision:
      await enqueueContentRevision(plan),
    topic_expansion: null,
  };
}
