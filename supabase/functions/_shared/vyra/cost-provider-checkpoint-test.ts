import {
  runCostProtectedProviderCallWithRpc,
  type CostRpcInvoker,
} from "./cost-provider-checkpoint.ts";

Deno.test(
  "VYRA settled provider checkpoint is restored without another provider call",
  async () => {
    const reservationId = "00000000-0000-4000-8000-000000000701";
    const rpcCalls: string[] = [];
    let executeCalls = 0;

    const rpc: CostRpcInvoker = async (functionName) => {
      rpcCalls.push(functionName);

      if (functionName === "reserve_vyra_cost_budget") {
        return {
          id: reservationId,
          status: "settled",
        };
      }

      if (functionName === "load_vyra_cost_provider_result") {
        return {
          id: reservationId,
          status: "settled",
          provider_result: {
            text: "restored provider result",
          },
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    };

    const result = await runCostProtectedProviderCallWithRpc(
      {
        jobId: "00000000-0000-4000-8000-000000000700",
        provider: "openai",
        operation: "content_draft",
        reservedEurMicros: 10_000,
        execute: async () => {
          executeCalls += 1;
          return "new provider result";
        },
        restore: (value) => {
          const text = (value as { text?: unknown }).text;

          if (typeof text !== "string") {
            throw new Error("Checkpoint result could not be restored");
          }

          return text;
        },
      },
      rpc,
    );

    if (
      result.result !== "restored provider result" ||
      result.reservationId !== reservationId ||
      !result.reusedCheckpoint
    ) {
      throw new Error("Settled checkpoint was not restored correctly");
    }

    if (executeCalls !== 0) {
      throw new Error("Settled checkpoint unexpectedly called the provider");
    }

    if (
      rpcCalls.length !== 2 ||
      rpcCalls[0] !== "reserve_vyra_cost_budget" ||
      rpcCalls[1] !== "load_vyra_cost_provider_result"
    ) {
      throw new Error("Settled checkpoint used an unexpected RPC sequence");
    }
  },
);

Deno.test(
  "VYRA checkpoint failure after a provider call requires manual review",
  async () => {
    const reservationId = "00000000-0000-4000-8000-000000000711";
    const rpcCalls: string[] = [];
    let executeCalls = 0;

    const rpc: CostRpcInvoker = async (functionName) => {
      rpcCalls.push(functionName);

      if (functionName === "reserve_vyra_cost_budget") {
        return {
          id: reservationId,
          status: "reserved",
        };
      }

      if (functionName === "begin_vyra_cost_provider_call") {
        return {
          id: reservationId,
          status: "in_flight",
        };
      }

      if (functionName === "checkpoint_vyra_cost_provider_result") {
        throw new Error("simulated checkpoint persistence failure");
      }

      if (
        functionName ===
          "mark_vyra_cost_reservation_manual_review"
      ) {
        return {
          id: reservationId,
          status: "manual_review",
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    };

    let errorMessage = "";

    try {
      await runCostProtectedProviderCallWithRpc(
        {
          jobId: "00000000-0000-4000-8000-000000000710",
          provider: "openai",
          operation: "content_draft",
          reservedEurMicros: 10_000,
          execute: async () => {
            executeCalls += 1;
            return "successful provider result";
          },
          restore: (value) => String(value),
        },
        rpc,
      );
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : String(error);
    }

    if (
      !errorMessage.includes(
        "Paid provider result was retained for manual review",
      )
    ) {
      throw new Error(
        "Checkpoint failure did not report manual-review retention",
      );
    }

    if (executeCalls !== 1) {
      throw new Error("Provider call was not executed exactly once");
    }

    const expectedCalls = [
      "reserve_vyra_cost_budget",
      "begin_vyra_cost_provider_call",
      "checkpoint_vyra_cost_provider_result",
      "mark_vyra_cost_reservation_manual_review",
    ];

    if (rpcCalls.join("|") !== expectedCalls.join("|")) {
      throw new Error(
        `Unexpected checkpoint-failure RPC sequence: ${rpcCalls.join(", ")}`,
      );
    }
  },
);

Deno.test(
  "VYRA manual-review reservation blocks a new provider call",
  async () => {
    const reservationId = "00000000-0000-4000-8000-000000000721";
    const rpcCalls: string[] = [];
    let executeCalls = 0;

    const rpc: CostRpcInvoker = async (functionName) => {
      rpcCalls.push(functionName);

      if (functionName === "reserve_vyra_cost_budget") {
        return {
          id: reservationId,
          status: "manual_review",
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    };

    let errorMessage = "";

    try {
      await runCostProtectedProviderCallWithRpc(
        {
          jobId: "00000000-0000-4000-8000-000000000720",
          provider: "openai",
          operation: "content_draft",
          reservedEurMicros: 10_000,
          execute: async () => {
            executeCalls += 1;
            return "provider result";
          },
          restore: (value) => String(value),
        },
        rpc,
      );
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : String(error);
    }

    if (
      !errorMessage.includes(
        "VYRA provider call requires manual review",
      )
    ) {
      throw new Error(
        "Manual-review reservation did not block the provider call",
      );
    }

    if (executeCalls !== 0) {
      throw new Error(
        "Manual-review reservation unexpectedly called the provider",
      );
    }

    if (
      rpcCalls.length !== 1 ||
      rpcCalls[0] !== "reserve_vyra_cost_budget"
    ) {
      throw new Error(
        "Manual-review reservation used an unexpected RPC sequence",
      );
    }
  },
);

Deno.test(
  "VYRA interrupted in-flight provider call is moved to manual review",
  async () => {
    const reservationId = "00000000-0000-4000-8000-000000000731";
    const rpcCalls: string[] = [];
    let executeCalls = 0;

    const rpc: CostRpcInvoker = async (functionName) => {
      rpcCalls.push(functionName);

      if (functionName === "reserve_vyra_cost_budget") {
        return {
          id: reservationId,
          status: "in_flight",
        };
      }

      if (
        functionName ===
          "mark_vyra_cost_reservation_manual_review"
      ) {
        return {
          id: reservationId,
          status: "manual_review",
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    };

    let errorMessage = "";

    try {
      await runCostProtectedProviderCallWithRpc(
        {
          jobId: "00000000-0000-4000-8000-000000000730",
          provider: "tavily",
          operation: "research_worker_search",
          reservedEurMicros: 10_000,
          execute: async () => {
            executeCalls += 1;
            return "provider result";
          },
          restore: (value) => String(value),
        },
        rpc,
      );
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : String(error);
    }

    if (
      !errorMessage.includes(
        "VYRA provider call was moved to manual review",
      )
    ) {
      throw new Error(
        "Interrupted provider call did not require manual review",
      );
    }

    if (executeCalls !== 0) {
      throw new Error(
        "Interrupted provider call unexpectedly ran the provider again",
      );
    }

    const expectedCalls = [
      "reserve_vyra_cost_budget",
      "mark_vyra_cost_reservation_manual_review",
    ];

    if (rpcCalls.join("|") !== expectedCalls.join("|")) {
      throw new Error(
        `Unexpected in-flight RPC sequence: ${rpcCalls.join(", ")}`,
      );
    }
  },
);

Deno.test(
  "VYRA reserved provider call is checkpointed exactly once",
  async () => {
    const reservationId = "00000000-0000-4000-8000-000000000741";
    const rpcCalls: string[] = [];
    let executeCalls = 0;

    const rpc: CostRpcInvoker = async (functionName) => {
      rpcCalls.push(functionName);

      if (functionName === "reserve_vyra_cost_budget") {
        return {
          id: reservationId,
          status: "reserved",
        };
      }

      if (functionName === "begin_vyra_cost_provider_call") {
        return {
          id: reservationId,
          status: "in_flight",
        };
      }

      if (functionName === "checkpoint_vyra_cost_provider_result") {
        return {
          id: reservationId,
          status: "settled",
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    };

    const result = await runCostProtectedProviderCallWithRpc(
      {
        jobId: "00000000-0000-4000-8000-000000000740",
        provider: "tavily",
        operation: "research_worker_search",
        reservedEurMicros: 10_000,
        execute: async () => {
          executeCalls += 1;
          return "provider result";
        },
        restore: (value) => String(value),
      },
      rpc,
    );

    if (
      result.result !== "provider result" ||
      result.reservationId !== reservationId ||
      result.reusedCheckpoint
    ) {
      throw new Error(
        "Reserved provider call did not return its checkpointed result",
      );
    }

    if (executeCalls !== 1) {
      throw new Error(
        "Reserved provider call was not executed exactly once",
      );
    }

    const expectedCalls = [
      "reserve_vyra_cost_budget",
      "begin_vyra_cost_provider_call",
      "checkpoint_vyra_cost_provider_result",
    ];

    if (rpcCalls.join("|") !== expectedCalls.join("|")) {
      throw new Error(
        `Unexpected successful-call RPC sequence: ${rpcCalls.join(", ")}`,
      );
    }
  },
);

Deno.test(
  "VYRA provider failure after dispatch requires manual review",
  async () => {
    const reservationId = "00000000-0000-4000-8000-000000000751";
    const rpcCalls: string[] = [];

    const rpc: CostRpcInvoker = async (functionName) => {
      rpcCalls.push(functionName);

      if (functionName === "reserve_vyra_cost_budget") {
        return {
          id: reservationId,
          status: "reserved",
        };
      }

      if (functionName === "begin_vyra_cost_provider_call") {
        return {
          id: reservationId,
          status: "in_flight",
        };
      }

      if (
        functionName ===
          "mark_vyra_cost_reservation_manual_review"
      ) {
        return {
          id: reservationId,
          status: "manual_review",
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    };

    let errorMessage = "";

    try {
      await runCostProtectedProviderCallWithRpc(
        {
          jobId: "00000000-0000-4000-8000-000000000750",
          provider: "tavily",
          operation: "topic_scout_search",
          reservedEurMicros: 10_000,
          execute: async () => {
            throw new Error("simulated provider network failure");
          },
          restore: (value) => String(value),
        },
        rpc,
      );
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : String(error);
    }

    if (
      !errorMessage.includes(
        "Paid provider call was retained for manual review",
      )
    ) {
      throw new Error(
        "Provider failure did not report manual-review retention",
      );
    }

    const expectedCalls = [
      "reserve_vyra_cost_budget",
      "begin_vyra_cost_provider_call",
      "mark_vyra_cost_reservation_manual_review",
    ];

    if (rpcCalls.join("|") !== expectedCalls.join("|")) {
      throw new Error(
        `Unexpected provider-failure RPC sequence: ${rpcCalls.join(", ")}`,
      );
    }
  },
);

Deno.test(
  "VYRA non-serializable provider result requires manual review",
  async () => {
    const reservationId = "00000000-0000-4000-8000-000000000761";
    const rpcCalls: string[] = [];

    const rpc: CostRpcInvoker = async (functionName) => {
      rpcCalls.push(functionName);

      if (functionName === "reserve_vyra_cost_budget") {
        return {
          id: reservationId,
          status: "reserved",
        };
      }

      if (functionName === "begin_vyra_cost_provider_call") {
        return {
          id: reservationId,
          status: "in_flight",
        };
      }

      if (
        functionName ===
          "mark_vyra_cost_reservation_manual_review"
      ) {
        return {
          id: reservationId,
          status: "manual_review",
        };
      }

      throw new Error(`Unexpected RPC: ${functionName}`);
    };

    const circularResult: { self?: unknown } = {};
    circularResult.self = circularResult;

    let errorMessage = "";

    try {
      await runCostProtectedProviderCallWithRpc(
        {
          jobId: "00000000-0000-4000-8000-000000000760",
          provider: "openai",
          operation: "content_draft",
          reservedEurMicros: 10_000,
          execute: async () => circularResult,
          restore: (value) => value as { self?: unknown },
        },
        rpc,
      );
    } catch (error) {
      errorMessage = error instanceof Error
        ? error.message
        : String(error);
    }

    if (
      !errorMessage.includes(
        "Paid provider result was retained for manual review",
      )
    ) {
      throw new Error(
        "Non-serializable result did not report manual-review retention",
      );
    }

    const expectedCalls = [
      "reserve_vyra_cost_budget",
      "begin_vyra_cost_provider_call",
      "mark_vyra_cost_reservation_manual_review",
    ];

    if (rpcCalls.join("|") !== expectedCalls.join("|")) {
      throw new Error(
        `Unexpected serialization-failure RPC sequence: ${rpcCalls.join(", ")}`,
      );
    }
  },
);