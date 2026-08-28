import type {
  ResearchProvider,
  ResearchRequest,
  ResearchResult,
} from "./research.ts";

type TavilySearchResult = {
  title?: string;
  url?: string;
  content?: string;
};

type TavilyResponse = {
  results?: TavilySearchResult[];
};

export class TavilyResearchProvider implements ResearchProvider {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(
    request: ResearchRequest,
  ): Promise<ResearchResult[]> {
    const response = await fetch(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query: request.query,
          topic: "general",
          search_depth: "basic",
          max_results: Math.min(
            Math.max(request.max_results, 1),
            20,
          ),
          include_answer: false,
          include_raw_content: false,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Tavily search failed: ${response.status} ${errorText}`,
      );
    }

    const data = (await response.json()) as TavilyResponse;

    return (data.results ?? []).map((item) => ({
      title: item.title ?? "",
      snippet: item.content ?? "",
      url: item.url ?? "",
      source: "tavily",
    }));
  }
}