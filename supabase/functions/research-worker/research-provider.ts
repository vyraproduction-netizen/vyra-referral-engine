import {
  researchWithMock,
} from "./mock-research.ts";
import {
  researchWithTavily,
  type TavilyResearchResult,
} from "./tavily-research.ts";

export type ResearchProvider = (
  query: string,
) => Promise<TavilyResearchResult>;

export type ResearchProviderName =
  | "tavily"
  | "mock";

export function resolveResearchProviderName(
  value: string | undefined,
): ResearchProviderName {
  const normalized =
    value?.trim().toLowerCase() ?? "tavily";

  if (normalized === "tavily" || normalized === "mock") {
    return normalized;
  }

  throw new Error(
    `Unsupported RESEARCH_PROVIDER: ${value}`,
  );
}

export function createResearchProvider(
  name: ResearchProviderName,
): ResearchProvider {
  return name === "mock"
    ? researchWithMock
    : researchWithTavily;
}
