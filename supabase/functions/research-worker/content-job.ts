import type {
  CreatedVyraJob,
  JobStore,
  VyraJobInput,
} from "../_shared/vyra/job-store.ts";
import type {
  ResearchFinding,
  ResearchJob,
} from "./research.ts";
import type {
  ResearchExpandedTopicLineage,
} from "./research-expanded-topic-lineage.ts";

export type ContentJobPayload = {
  request_id: string;
  language: string;
  region: string;
  topic_seed: string;
  source_job_id: string;
  candidate: {
    title: string;
    url: string;
  };
  recommendation: string;
  research: ResearchFinding["research"];
  evidence: {
    evidence_source: string;
    opportunity_score: number;
    commercial_intent: number;
    content_potential: number;
    referral_potential: number;
    relevance: number;
  };
  topic_expansion?: ResearchExpandedTopicLineage;
  _meta: {
    dedupe_key: string;
  };
};

export type ContentJob = VyraJobInput & {
  agent: "content";
  task_type: "content_draft";
  payload: ContentJobPayload;
};

type ContentJobStore = Pick<
  JobStore,
  "createMany" | "existsByDedupeKey"
>;

export function buildContentJob(
  sourceJob: ResearchJob,
  finding: ResearchFinding,
  topicExpansion: ResearchExpandedTopicLineage | null = null,
): ContentJob | null {
  if (finding.recommendation === "discard") {
    return null;
  }

  const candidateUrl =
    finding.candidate_url.trim().toLowerCase();

  if (!candidateUrl) {
    throw new Error("Content candidate URL is required");
  }

  const dedupeKey =
    `${sourceJob.id}:content_draft:${candidateUrl}`;

  return {
    agent: "content",
    task_type: "content_draft",
    status: "queued",
    priority: Math.round(
      finding.content_potential * 100,
    ),
    max_attempts: 3,
    payload: {
      request_id: sourceJob.payload.request_id,
      language: sourceJob.payload.language,
      region: sourceJob.payload.region,
      topic_seed: sourceJob.payload.topic_seed,
      source_job_id: sourceJob.id,
      candidate: {
        title: finding.candidate_title,
        url: finding.candidate_url,
      },
      recommendation: finding.recommendation,
      research: finding.research,
      evidence: {
        evidence_source: finding.evidence_source,
        opportunity_score: finding.opportunity_score,
        commercial_intent: finding.commercial_intent,
        content_potential: finding.content_potential,
        referral_potential: finding.referral_potential,
        relevance: finding.relevance,
      },
      ...(topicExpansion
        ? {
          topic_expansion: {
            lineage: { ...topicExpansion.lineage },
            safeguards: { ...topicExpansion.safeguards },
          },
        }
        : {}),
      _meta: {
        dedupe_key: dedupeKey,
      },
    },
  };
}

export async function enqueueContentJob(
  store: ContentJobStore,
  sourceJob: ResearchJob,
  finding: ResearchFinding,
  topicExpansion: ResearchExpandedTopicLineage | null = null,
): Promise<CreatedVyraJob | null> {
  const contentJob = buildContentJob(
    sourceJob,
    finding,
    topicExpansion,
  );

  if (!contentJob) {
    return null;
  }

  const dedupeKey =
    contentJob.payload._meta.dedupe_key;

  if (await store.existsByDedupeKey(dedupeKey)) {
    return null;
  }

  const created = await store.createMany([
    contentJob,
  ]);

  return created[0] ?? null;
}
