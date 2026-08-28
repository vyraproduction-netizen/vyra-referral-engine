import {
  filterNewResearchJobs,
} from "./job-dedupe.ts";

const duplicateKey =
  "22222222-2222-2222-2222-222222222222:topic_research:https://www.krea.ai/apps/enhance";

const jobs = [
  {
    job: {
      agent: "research",
      task_type: "topic_research",
      status: "queued",
      priority: 75,
      payload: {},
      max_attempts: 3,
    },
    dedupe_key: duplicateKey,
  },
];

const result = await filterNewResearchJobs(
  jobs,
  async (dedupeKey) => {
    console.log("Checker received:", dedupeKey);
    return dedupeKey === duplicateKey;
  },
);

console.log(
  JSON.stringify(
    {
      input_jobs: jobs.length,
      new_jobs: result.length,
      expected_new_jobs: 0,
    },
    null,
    2,
  ),
);