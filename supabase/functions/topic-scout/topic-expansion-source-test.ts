import type { SupabaseClient } from "jsr:@supabase/supabase-js@2.112.4";
import { loadTopicExpansionSource } from "./topic-expansion-source.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

type QueryResult = {
  data: unknown;
  error: { message: string } | null;
};

function clientFor(
  result: QueryResult,
  observed: string[] = [],
): SupabaseClient {
  return {
    from(table: string) {
      observed.push(`from:${table}`);

      return {
        select(columns: string) {
          observed.push(`select:${columns}`);

          return {
            eq(field: string, value: string) {
              observed.push(`eq:${field}:${value}`);

              return {
                maybeSingle: async () => result,
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;
}

async function errorMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error
      ? error.message
      : String(error);
  }

  return "";
}

Deno.test("loads only the required topic expansion source fields", async () => {
  const observed: string[] = [];
  const source = await loadTopicExpansionSource(
    clientFor({
      data: {
        id: "00000000-0000-4000-8000-000000008100",
        title: "Image enhancement",
        language: "ru",
        status: "published",
        evidence: { region: "EU" },
      },
      error: null,
    }, observed),
    "00000000-0000-4000-8000-000000008100",
  );

  assert(source.status === "published", "Status mismatch");
  assert(source.evidence.region === "EU", "Evidence mismatch");
  assert(observed[0] === "from:content", "Wrong table queried");
  assert(
    observed[1] === "select:id, title, language, status, evidence",
    "Source query selected unexpected fields",
  );
  assert(
    observed[2] ===
      "eq:id:00000000-0000-4000-8000-000000008100",
    "Source query id mismatch",
  );
});

Deno.test("rejects a missing source content id before querying", async () => {
  const observed: string[] = [];
  const message = await errorMessage(() =>
    loadTopicExpansionSource(
      clientFor({ data: null, error: null }, observed),
      " ",
    )
  );

  assert(
    message === "Topic expansion source content id is required",
    "Missing id was accepted",
  );
  assert(observed.length === 0, "Database was queried for an empty id");
});

Deno.test("rejects an absent source content row", async () => {
  const message = await errorMessage(() =>
    loadTopicExpansionSource(
      clientFor({ data: null, error: null }),
      "00000000-0000-4000-8000-000000008101",
    )
  );

  assert(
    message === "Topic expansion source content was not found",
    "Absent source was accepted",
  );
});

Deno.test("reports a source database failure", async () => {
  const message = await errorMessage(() =>
    loadTopicExpansionSource(
      clientFor({
        data: null,
        error: { message: "connection unavailable" },
      }),
      "00000000-0000-4000-8000-000000008102",
    )
  );

  assert(
    message ===
      "Topic expansion source load failed: connection unavailable",
    "Database failure was hidden",
  );
});

Deno.test("rejects malformed source evidence", async () => {
  const message = await errorMessage(() =>
    loadTopicExpansionSource(
      clientFor({
        data: {
          id: "00000000-0000-4000-8000-000000008103",
          title: "Image enhancement",
          language: "ru",
          status: "published",
          evidence: null,
        },
        error: null,
      }),
      "00000000-0000-4000-8000-000000008103",
    )
  );

  assert(
    message === "Topic expansion source evidence is invalid",
    "Malformed evidence was accepted",
  );
});
