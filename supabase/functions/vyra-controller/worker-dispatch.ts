export const workerDispatchRoutes = {
  research: "research-worker",
  content: "content-worker",
  qa: "qa-worker",
  publisher: "publisher-worker",
  analytics: "analytics-worker",
  optimizer: "optimizer-worker",
  repeat: "repeat-worker",
} as const;

export type WorkerDispatchAgent = keyof typeof workerDispatchRoutes;

export function resolveWorkerDispatchRoute(
  agent: string,
): string | null {
  if (
    !Object.prototype.hasOwnProperty.call(
      workerDispatchRoutes,
      agent,
    )
  ) {
    return null;
  }

  return workerDispatchRoutes[
    agent as WorkerDispatchAgent
  ];
}

export const supportedDispatchAgents = [
  "topic_scout",
  ...Object.keys(workerDispatchRoutes),
] as const;

export function createWorkerDispatchHeaders(
  workerSecret: string | undefined,
): Record<string, string> {
  if (!workerSecret?.trim()) {
    throw new Error("VYRA_WORKER_SECRET is required");
  }

  return {
    "Content-Type": "application/json",
    [VYRA_WORKER_SECRET_HEADER]: workerSecret,
  };
}
import { VYRA_WORKER_SECRET_HEADER } from "../_shared/vyra/worker-auth.ts";
