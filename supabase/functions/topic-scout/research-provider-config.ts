export type TopicScoutResearchProviderName =
  | "mock"
  | "tavily";

export function resolveTopicScoutResearchProviderName(
  value: string | undefined,
): TopicScoutResearchProviderName {
  const normalized = value?.trim().toLowerCase() ?? "mock";

  if (normalized === "mock" || normalized === "tavily") {
    return normalized;
  }

  throw new Error(
    `Unsupported RESEARCH_PROVIDER: ${value}`,
  );
}