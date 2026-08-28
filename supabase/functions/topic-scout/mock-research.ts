import type {
  ResearchProvider,
  ResearchRequest,
  ResearchResult,
} from "./research.ts";

export class LocalMockResearchProvider implements ResearchProvider {
  async search(
    request: ResearchRequest,
  ): Promise<ResearchResult[]> {
    const query = request.query.trim();

    return [
      {
        title: `AI tools for ${query}`,
        snippet:
          `Local mock result for researching "${query}" in ${request.region}.`,
        url: "https://example.local/research/ai-tools",
        source: "local-mock",
      },
      {
        title: `How to improve ${query}`,
        snippet:
          `Mock research result focused on practical improvement of ${query}.`,
        url: "https://example.local/research/improve",
        source: "local-mock",
      },
      {
        title: `${query} trends and use cases`,
        snippet:
          `Mock research result describing trends and use cases related to ${query}.`,
        url: "https://example.local/research/trends",
        source: "local-mock",
      },
    ].slice(0, request.max_results);
  }
}