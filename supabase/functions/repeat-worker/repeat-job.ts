import type {
  VyraJob,
} from "../_shared/vyra/job-store.ts";
import {
  assertRepeatWorkerJob,
  buildRepeatExecutionPlan,
  type RepeatExecutionPlan,
} from "./plan.ts";

export type RepeatJobResult = {
  execution_status: "planned";
  plan: RepeatExecutionPlan;
};

export function runRepeatJob(
  job: VyraJob,
): RepeatJobResult {
  assertRepeatWorkerJob(job);

  return {
    execution_status: "planned",
    plan: buildRepeatExecutionPlan(job),
  };
}
