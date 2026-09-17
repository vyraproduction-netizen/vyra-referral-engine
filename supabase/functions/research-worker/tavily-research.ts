export type TavilyResearchResult = {
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
  }>;
};

export function buildTavilySearchRequest(
  apiKey: string,
  query: string,
): Request {
  return new Request(
    "https://api.tavily.com/search",
    {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        include_answer: true,
        max_results: 5,
      }),
    },
  );
}

export async function researchWithTavily(
  query: string,
): Promise<TavilyResearchResult> {
  const apiKey = Deno.env.get("TAVILY_API_KEY");

  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is required");
  }

  const response = await fetch(
    buildTavilySearchRequest(apiKey, query),
  );

  if (!response.ok) {
    const message = await response.text();

    throw new Error(
      `Tavily research failed: ${response.status} ${message}`,
    );
  }

  const data = await response.json();

  return {
    query,
    answer:
      typeof data.answer === "string"
        ? data.answer
        : undefined,
    results: Array.isArray(data.results)
      ? data.results.map((item: {
          title?: unknown;
          url?: unknown;
          content?: unknown;
          score?: unknown;
        }) => ({
          title:
            typeof item.title === "string"
              ? item.title
              : "",
          url:
            typeof item.url === "string"
              ? item.url
              : "",
          content:
            typeof item.content === "string"
              ? item.content
              : "",
          score:
            typeof item.score === "number"
              ? item.score
              : undefined,
        }))
      : [],
  };
}