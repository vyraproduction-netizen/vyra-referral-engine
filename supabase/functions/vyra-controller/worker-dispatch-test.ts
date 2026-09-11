import {
  createWorkerDispatchHeaders,
  resolveWorkerDispatchRoute,
  supportedDispatchAgents,
} from "./worker-dispatch.ts";
import { VYRA_WORKER_SECRET_HEADER } from "../_shared/vyra/worker-auth.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

Deno.test("routes Repeat jobs to the Repeat Worker", () => {
  assert(
    resolveWorkerDispatchRoute("repeat") ===
      "repeat-worker",
    "Repeat dispatch route mismatch",
  );
});

Deno.test("preserves the Optimizer dispatch route", () => {
  assert(
    resolveWorkerDispatchRoute("optimizer") ===
      "optimizer-worker",
    "Optimizer dispatch route changed",
  );
});

Deno.test("keeps Topic Scout on its special dispatch path", () => {
  assert(
    resolveWorkerDispatchRoute("topic_scout") === null,
    "Topic Scout must not use a worker dispatch route",
  );
});

Deno.test("rejects an unsupported dispatch agent", () => {
  assert(
    resolveWorkerDispatchRoute("unknown") === null,
    "Unsupported dispatch agent was accepted",
  );
});

Deno.test("reports Repeat as a supported dispatch agent", () => {
  assert(
    supportedDispatchAgents.includes("repeat"),
    "Repeat is missing from supported dispatch agents",
  );
});

Deno.test("adds the internal secret to worker dispatch headers", () => {
  const headers = createWorkerDispatchHeaders(
    "internal-secret",
  );

  assert(
    headers[VYRA_WORKER_SECRET_HEADER] ===
      "internal-secret",
    "Worker dispatch secret header mismatch",
  );
  assert(
    headers["Content-Type"] === "application/json",
    "Worker dispatch content type changed",
  );
});

Deno.test("worker dispatch headers fail closed without a secret", () => {
  let rejected = false;

  try {
    createWorkerDispatchHeaders(undefined);
  } catch {
    rejected = true;
  }

  assert(rejected, "Missing worker dispatch secret was accepted");
});
