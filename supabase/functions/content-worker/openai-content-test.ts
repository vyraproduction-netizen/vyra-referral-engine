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

  const text = requestBody?.text as {
    format?: { type?: string; strict?: boolean; schema?: unknown };
  } | undefined;
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
