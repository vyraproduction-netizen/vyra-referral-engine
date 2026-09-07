import {
  createOpenAIContentProvider,
} from "./openai-content.ts";
import {
  generateMockContent,
} from "./mock-content.ts";

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

export type ContentProviderName =
  | "disabled"
  | "mock"
  | "openai";

export function resolveContentProviderName(
  value: string | undefined,
): ContentProviderName {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return "disabled";
  }

  if (normalized === "mock") {
    return "mock";
  }

  if (normalized === "openai") {
    return "openai";
  }

  throw new Error(
    `Unsupported CONTENT_PROVIDER: ${value}`,
  );
}

export function createContentProvider(
  name: ContentProviderName,
): ContentProvider {
  if (name === "mock") {
    return generateMockContent;
  }

  if (name === "openai") {
    return createOpenAIContentProvider();
  }

  return () => Promise.reject(
    new Error("CONTENT_PROVIDER is not configured"),
  );
}
