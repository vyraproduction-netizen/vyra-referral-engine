import {
  enqueueRepeatJobs,
  type CreatedRepeatJob,
  type RepeatJobStore,
} from "./repeat-persistence.ts";
import type {
  OptimizationAction,
  OptimizationDecision,
} from "./optimizer.ts";
import type {
  RepeatJob,
} from "./repeat.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

class MemoryRepeatJobStore implements RepeatJobStore {
  readonly jobs: RepeatJob[] = [];
  readonly dedupeKeys = new Set<string>();

  existsByDedupeKey(
    dedupeKey: string,
  ): Promise<boolean> {
    return Promise.resolve(this.dedupeKeys.has(dedupeKey));
  }

  createMany(
    jobs: RepeatJob[],
  ): Promise<CreatedRepeatJob[]> {
    const created = jobs.map((job, index) => {
      const dedupeKey = job.payload._meta.dedupe_key;
      this.jobs.push(job);
      this.dedupeKeys.add(dedupeKey);

      return {
        id: `repeat-job-${this.jobs.length + index}`,
        dedupeKey,
      };
    });

    return Promise.resolve(created);
  }
}

const source = {
  job_id: "00000000-0000-4000-8000-000000003100",
  request_id: "00000000-0000-4000-8000-000000003101",
};

function decision(
  action: OptimizationAction,
  contentSuffix: string,
): OptimizationDecision {
  const repeatable =
    action === "improve_content" || action === "scale_content";

  return {
    content_id:
      `00000000-0000-4000-8000-000000003${contentSuffix}`,
    referral_link_id:
      `00000000-0000-4000-8000-000000004${contentSuffix}`,
    action,
    reason: `Diagnostic ${action}`,
    priority: action === "improve_content" ? 80 : 60,
    conversion_rate: action === "scale_content" ? 0.05 : 0,
    metrics: {
      clicks: repeatable ? 20 : 10,
      conversions: action === "scale_content" ? 1 : 0,
      revenue: action === "scale_content" ? 25 : 0,
    },
  };
}

Deno.test(
  "persists only repeatable optimization decisions",
  async () => {
    const store = new MemoryRepeatJobStore();
    const created = await enqueueRepeatJobs(
      store,
      source,
      [
        decision("skip", "10"),
        decision("collect_more_data", "11"),
        decision("monitor", "12"),
        decision("improve_content", "13"),
        decision("scale_content", "14"),
      ],
    );

    assert(created.length === 2, "Expected two repeat jobs");
    assert(store.jobs.length === 2, "Unexpected stored job count");
    assert(
      store.jobs[0].task_type === "content_improvement",
      "Improvement job was not stored",
    );
    assert(
      store.jobs[1].task_type === "topic_expansion",
      "Scaling job was not stored",
    );
  },
);

Deno.test(
  "does not persist the same repeat jobs twice",
  async () => {
    const store = new MemoryRepeatJobStore();
    const decisions = [
      decision("improve_content", "20"),
      decision("scale_content", "21"),
    ];

    const first = await enqueueRepeatJobs(
      store,
      source,
      decisions,
    );
    const second = await enqueueRepeatJobs(
      store,
      source,
      decisions,
    );

    assert(first.length === 2, "First enqueue failed");
    assert(second.length === 0, "Duplicate jobs were created");
    assert(store.jobs.length === 2, "Stored duplicates found");
  },
);

Deno.test(
  "deduplicates equivalent decisions in one batch",
  async () => {
    const store = new MemoryRepeatJobStore();
    const repeated = decision("improve_content", "30");
    const created = await enqueueRepeatJobs(
      store,
      source,
      [repeated, repeated],
    );

    assert(created.length === 1, "Batch duplicate was created");
    assert(store.jobs.length === 1, "Batch stored duplicates");
  },
);

Deno.test(
  "persists a new repeat job after metrics change",
  async () => {
    const store = new MemoryRepeatJobStore();
    const firstDecision = decision("improve_content", "40");
    const secondDecision = {
      ...firstDecision,
      metrics: {
        ...firstDecision.metrics,
        clicks: firstDecision.metrics.clicks + 1,
      },
    };

    await enqueueRepeatJobs(store, source, [firstDecision]);
    const created = await enqueueRepeatJobs(
      store,
      source,
      [secondDecision],
    );

    assert(created.length === 1, "New metric cycle was skipped");
    assert(store.jobs.length === 2, "New cycle was not stored");
  },
);

Deno.test(
  "does not call createMany for passive decisions",
  async () => {
    const store = new MemoryRepeatJobStore();
    const created = await enqueueRepeatJobs(
      store,
      source,
      [decision("monitor", "50")],
    );

    assert(created.length === 0, "Passive job was created");
    assert(store.jobs.length === 0, "Passive job was stored");
  },
);
