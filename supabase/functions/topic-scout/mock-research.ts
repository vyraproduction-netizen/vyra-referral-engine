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
	    title:
		  `Professional AI tools with pricing plans for ${query}`,
        snippet:
          `Local mock business software subscription with a free trial ` +
          `for researching "${query}" in ${request.region}.`,
	    url:
		  `https://example.local/research/ai-tools-pricing/` +
		  `${encodeURIComponent(query)}`,
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