export type TopicScoutLedgerJob = { id: string; agent: string; status: string };

export function assertTopicScoutLedgerJob(
  job: TopicScoutLedgerJob | null,
  expectedJobId: string,
): asserts job is TopicScoutLedgerJob {
  if (!job || job.id !== expectedJobId) throw new Error("Topic Scout job was not found");
  if (job.agent !== "topic_scout") throw new Error("Topic Scout ledger job has an invalid agent");
  if (job.status !== "running") throw new Error("Topic Scout ledger job must be running");
}