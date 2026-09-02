export const workerDispatchRoutes = {
  research: "research-worker",
  content: "content-worker",
  qa: "qa-worker",
  publisher: "publisher-worker",
  analytics: "analytics-worker",
  optimizer: "optimizer-worker",
  repeat: "repeat-worker",
} as const;

export type WorkerDispatchAgent =
  keyof typeof workerDispatchRoutes;

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
