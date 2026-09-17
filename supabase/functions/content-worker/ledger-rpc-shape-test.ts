import { singleRpcRow } from "./ledger-rpc.ts";

function expectEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, received ${String(actual)}`);
  }
}

Deno.test("USD ledger RPC adapter requests exactly one response row", async () => {
  let calls = 0;
  const result = await singleRpcRow({
    single: async () => {
      calls += 1;
      return { data: { id: "test-observation", mode: "observe" }, error: null };
    },
  });

  expectEqual(calls, 1, "single call count");
  expectEqual(result.data.id, "test-observation", "observation id");
  expectEqual(result.data.mode, "observe", "observation mode");
  expectEqual(result.error, null, "RPC error");
});