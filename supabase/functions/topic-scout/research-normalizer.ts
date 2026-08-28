import type {
  ResearchResult,
} from "./research.ts";

export type NormalizedResearchResult = ResearchResult & {
  normalized_title: string;
  normalized_url: string;
};

function normalizeText(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);

    url.hash = "";
    url.search = "";

    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

export function normalizeResearch(
  results: ResearchResult[],
): NormalizedResearchResult[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();

  const normalized: NormalizedResearchResult[] = [];

  for (const result of results) {
    const normalizedTitle = normalizeText(result.title);
    const normalizedUrl = normalizeUrl(result.url ?? "");

    if (!normalizedTitle && !normalizedUrl) {
      continue;
    }

    if (
      (normalizedUrl && seenUrls.has(normalizedUrl)) ||
      (normalizedTitle && seenTitles.has(normalizedTitle))
    ) {
      continue;
    }

    if (normalizedUrl) {
      seenUrls.add(normalizedUrl);
    }

    if (normalizedTitle) {
      seenTitles.add(normalizedTitle);
    }

    normalized.push({
      ...result,
      normalized_title: normalizedTitle,
      normalized_url: normalizedUrl,
    });
  }

  return normalized;
}