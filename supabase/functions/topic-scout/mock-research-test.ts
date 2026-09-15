import {
  LocalMockResearchProvider,
} from "./mock-research.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test(
  "Local mock research keeps the run id out of the title",
  async () => {
    const requestId =
      "00000000-0000-4000-8000-000000000123";

    const results = await new LocalMockResearchProvider().search({
      request_id: requestId,
      query: "image enhancement",
      language: "ru",
      region: "EU",
      max_results: 1,
    });

    const result = results[0];

    assert(result, "Expected one mock result");

    assert(
      result.title ===
        "Professional AI tools with pricing plans for image enhancement",
      "Mock title contains unexpected technical data",
    );

    assert(
      !result.title.includes(requestId),
      "Mock title must not contain the run id",
    );

    assert(
      result.url ===
        "https://example.local/research/ai-tools-pricing/" +
          "image%20enhancement?run=" +
          requestId,
      "Mock URL must preserve the technical run id",
    );
  },
);