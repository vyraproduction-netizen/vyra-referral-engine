export type VyraJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "retry";

export interface VyraJob {
  id: string;
  agent: string;
  task_type: string;
  status: VyraJobStatus;
  attempts: number;
  max_attempts: number;
  payload?: Record<string, unknown> | null;
}

export interface VyraJobInput {
  agent: string;
  task_type: string;
  status: "queued";
  priority: number;
  max_attempts: number;
  payload: Record<string, unknown>;
}

export interface CreatedVyraJob {
  id: string;
  dedupeKey: string;
}

export interface JobStore {
  claim(agent: string): Promise<VyraJob | null>;

  complete(
    jobId: string,
    result: Record<string, unknown>,
  ): Promise<void>;

  retry(
    jobId: string,
    errorMessage: string,
  ): Promise<void>;

  createMany(
    jobs: VyraJobInput[],
  ): Promise<CreatedVyraJob[]>;

  existsByDedupeKey(
    dedupeKey: string,
  ): Promise<boolean>;
}
