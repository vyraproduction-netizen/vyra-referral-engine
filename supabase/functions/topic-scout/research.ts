export type ResearchRequest = {
  query: string;
  language: string;
  region: string;
  max_results: number;
};

export type ResearchResult = {
  title: string;
  snippet: string;
  url?: string;
  source: string;
};

export interface ResearchProvider {
  search(request: ResearchRequest): Promise<ResearchResult[]>;
}