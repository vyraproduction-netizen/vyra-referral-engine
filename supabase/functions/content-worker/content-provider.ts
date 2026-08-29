export type ContentGenerationInput = {
  title: string;
  url: string;
  language: string;
  region: string;
  topic_seed: string;
  recommendation: string;
  research_answer: string | null;
  research_sources: Array<{
    title: string;
    url: string;
    content: string;
    score?: number;
  }>;
};

export type GeneratedContent = {
  title: string;
  body: string;
  excerpt: string;
  meta_title: string;
  meta_description: string;
};

export type ContentProvider = (
  input: ContentGenerationInput,
) => Promise<GeneratedContent>;
