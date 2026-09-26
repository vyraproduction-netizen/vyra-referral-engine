import type {
  ContentGenerationInput,
  ContentProvider,
} from "./content-provider.ts";
import {
  assertRevisionSource,
  buildContentRevisionDraft,
} from "./revision.ts";
import type {
  ContentRevisionDraft,
  ContentRevisionJob,
  RevisionSourceContent,
} from "./revision.ts";

function requiredHttpsUrl(
  value: string | null,
): string {
  if (!value) {
    throw new Error(
      "Published revision source URL is required",
    );
  }

  const url = new URL(value);

  if (url.protocol !== "https:") {
    throw new Error(
      "Published revision source URL must use HTTPS",
    );
  }

  return url.toString();
}

export function buildRevisionGenerationInput(
  job: ContentRevisionJob,
  source: RevisionSourceContent,
): ContentGenerationInput {
  assertRevisionSource(job, source);

  return {
    title: source.title,
    url: requiredHttpsUrl(source.published_url),
    language: source.language,
    region: "revision",
    topic_seed: source.slug,
    recommendation: job.payload.revision.reason,
    research_answer: source.body,
    research_sources: [],
  };
}

export async function runContentRevision(
  job: ContentRevisionJob,
  source: RevisionSourceContent,
  provider: ContentProvider,
): Promise<ContentRevisionDraft> {
  const generated = await provider(
    buildRevisionGenerationInput(job, source),
  );

  return buildContentRevisionDraft(
    job,
    source,
    generated,
  );
}
