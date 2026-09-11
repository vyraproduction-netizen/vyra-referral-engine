import { assertEquals } from "jsr:@std/assert";
import { singleRpcRow } from "./ledger-rpc.ts";

Deno.test("USD ledger RPC adapter requests exactly one response row", async () => {
  let calls = 0;
  const result = await singleRpcRow({
    single: async () => {
      calls += 1;
      return { data: { id: "test-observation", mode: "observe" }, error: null };
    },
  });

  assertEquals(calls, 1);
  assertEquals(result.data.id, "test-observation");
  assertEquals(result.data.mode, "observe");
  assertEquals(result.error, null);
});