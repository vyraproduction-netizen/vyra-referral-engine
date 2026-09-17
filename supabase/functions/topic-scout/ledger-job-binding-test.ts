import { assertTopicScoutLedgerJob } from "./ledger-job-binding.ts";
function mustThrow(run: () => void, text: string) { try { run(); } catch { return; } throw new Error(text); }
Deno.test("Topic Scout ledger binding accepts only its running job", () => {
  assertTopicScoutLedgerJob({ id: "11111111-1111-4111-8111-111111111111", agent: "topic_scout", status: "running" }, "11111111-1111-4111-8111-111111111111");
  mustThrow(() => assertTopicScoutLedgerJob(null, "11111111-1111-4111-8111-111111111111"), "Missing job accepted");
  mustThrow(() => assertTopicScoutLedgerJob({ id: "11111111-1111-4111-8111-111111111111", agent: "research", status: "running" }, "11111111-1111-4111-8111-111111111111"), "Wrong agent accepted");
  mustThrow(() => assertTopicScoutLedgerJob({ id: "11111111-1111-4111-8111-111111111111", agent: "topic_scout", status: "queued" }, "11111111-1111-4111-8111-111111111111"), "Queued job accepted");
});