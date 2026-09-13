import {
  createOpenAIContentProvider,
} from "./openai-content.ts";

const input = {
  title: "Example Enhancer",
  url: "https://example.local/tools/image-enhancer",
  language: "ru",
  region: "EU",
  topic_seed: "image enhancement",
  recommendation: "investigate_referral_program",
  research_answer: "A referral program may be available.",
  research_sources: [
    {
      title: "Example source",
      url: "https://example.local/source",
      content: "Example evidence",
      score: 0.9,
    },
  ],
};

const generated = {
  title: "Example Enhancer: обзор возможностей",
  body: "# Example Enhancer\n\nПроверенный обзор.",
  excerpt: "Краткий проверенный обзор.",
  meta_title: "Example Enhancer — обзор",
  meta_description: "Проверенный обзор возможностей Example Enhancer.",
};

Deno.test("OpenAI content provider requests strict structured output", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const provider = createOpenAIContentProvider({
    apiKey: "test-key",
    model: "test-model",
    maxOutputTokens: 1_200,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(generated) }],
        }],
      });
    },
  });

  const result = await provider(input);

  if (result.body !== generated.body) {
    throw new Error("Structured content body was not returned");
  }

  const request = requestBody as {
    reasoning?: { effort?: string };
    text?: {
      verbosity?: string;
      format?: { type?: string; strict?: boolean; schema?: unknown };
    };
  } | undefined;
  const text = request?.text;
  if (
    text?.format?.type !== "json_schema" ||
    text.format.strict !== true ||
    !text.format.schema
  ) {
    throw new Error("OpenAI request did not require strict JSON Schema output");
  }

  if (requestBody?.max_output_tokens !== 1_200) {
    throw new Error("OpenAI request did not enforce the configured output token limit");
  }

  if (request?.reasoning?.effort !== "minimal") {
    throw new Error("OpenAI request did not minimize reasoning effort");
  }

  if (text?.verbosity !== "low") {
    throw new Error("OpenAI request did not request low verbosity");
  }
});

Deno.test("OpenAI content provider preserves token usage", async () => {
  const provider = createOpenAIContentProvider({
    apiKey: "test-key",
    model: "test-model",
    maxOutputTokens: 1_200,
    fetchImpl: async () => Response.json({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(generated) }],
      }],
      usage: {
        input_tokens: 123,
        output_tokens: 45,
        total_tokens: 168,
        input_tokens_details: { cached_tokens: 10 },
        output_tokens_details: { reasoning_tokens: 4 },
      },
    }),
  });

  const result = await provider(input);

  if (
    result.usage?.input_tokens !== 123 ||
    result.usage.output_tokens !== 45 ||
    result.usage.total_tokens !== 168 ||
    result.usage.cached_input_tokens !== 10 ||
    result.usage.reasoning_tokens !== 4
  ) {
    throw new Error("OpenAI response usage was not preserved");
  }
});

Deno.test("OpenAI content provider bounds untrusted prompt fields", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const provider = createOpenAIContentProvider({
    apiKey: "test-key",
    model: "test-model",
    maxOutputTokens: 1_200,
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        output: [{
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(generated) }],
        }],
      });
    },
  });

  await provider({
    ...input,
    title: "t".repeat(301),
    url: `https://example.local/${"u".repeat(2_100)}`,
    language: "l".repeat(33),
    region: "r".repeat(65),
    topic_seed: "s".repeat(301),
    recommendation: "m".repeat(301),
    research_answer: "a".repeat(4_001),
    research_sources: [{
      title: "x".repeat(301),
      url: `https://example.local/${"y".repeat(2_100)}`,
      content: "c".repeat(4_001),
    }],
  });

  const userContent = String(
    (requestBody as {
      input?: Array<{ content?: unknown }>;
    }).input?.[1]?.content,
  );
  const supplied = JSON.parse(
    userContent.slice(userContent.indexOf("Input:\n") + 7),
  ) as {
    candidate: { title: string; url: string };
    language: string;
    region: string;
    topic_seed: string;
    recommendation: string;
    research_answer: string;
    research_sources: Array<{
      title: string;
      url: string;
      content: string;
    }>;
  };

  if (
    supplied.candidate.title.length > 300 ||
    supplied.candidate.url.length > 2_000 ||
    supplied.language.length > 32 ||
    supplied.region.length > 64 ||
    supplied.topic_seed.length > 300 ||
    supplied.recommendation.length > 300 ||
    supplied.research_answer.length > 4_000 ||
    supplied.research_sources[0].title.length > 300 ||
    supplied.research_sources[0].url.length > 2_000 ||
    supplied.research_sources[0].content.length > 4_000
  ) {
    throw new Error("OpenAI prompt input was not bounded");
  }
});

Deno.test("OpenAI content provider rejects incomplete model output", async () => {
  const provider = createOpenAIContentProvider({
    apiKey: "test-key",
    model: "test-model",
    maxOutputTokens: 1_200,
    fetchImpl: async () => Response.json({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: '{"title":"Only title"}' }],
      }],
    }),
  });

  try {
    await provider(input);
  } catch (error) {
    if (String(error).includes("body")) return;
    throw error;
  }

  throw new Error("Incomplete model output was accepted");
});

Deno.test("OpenAI content provider requires an explicit model", () => {
  try {
    createOpenAIContentProvider({ apiKey: "test-key", model: "" });
  } catch (error) {
    if (String(error).includes("OPENAI_CONTENT_MODEL")) return;
    throw error;
  }

  throw new Error("Missing explicit model was accepted");
});

Deno.test("OpenAI content provider requires a bounded output token limit", () => {
  for (const maxOutputTokens of [undefined, 511, 2_049, "not-a-number"]) {
    try {
      createOpenAIContentProvider({
        apiKey: "test-key",
        model: "test-model",
        maxOutputTokens,
      });
    } catch (error) {
      if (String(error).includes("OPENAI_CONTENT_MAX_OUTPUT_TOKENS")) continue;
      throw error;
    }

    throw new Error(`Invalid output token limit was accepted: ${maxOutputTokens}`);
  }
});
