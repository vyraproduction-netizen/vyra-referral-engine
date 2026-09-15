import {
  resolveTopicScoutResearchProviderName,
} from "./research-provider-config.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("Topic Scout research provider defaults to mock", () => {
  assert(
    resolveTopicScoutResearchProviderName(undefined) === "mock",
    "Missing Topic Scout provider must default to mock",
  );
});

Deno.test("Topic Scout research provider normalizes supported names", () => {
  assert(
    resolveTopicScoutResearchProviderName(" TAVILY ") === "tavily",
    "Tavily provider was not normalized",
  );

  assert(
    resolveTopicScoutResearchProviderName("MOCK") === "mock",
    "Mock provider was not normalized",
  );
});

Deno.test("Topic Scout research provider rejects unsupported names", () => {
  let errorMessage = "";

  try {
    resolveTopicScoutResearchProviderName("tavliy");
  } catch (error) {
    errorMessage = error instanceof Error
      ? error.message
      : String(error);
  }

  assert(
    errorMessage.includes("Unsupported RESEARCH_PROVIDER: tavliy"),
    "Unsupported Topic Scout provider was not rejected",
  );
});