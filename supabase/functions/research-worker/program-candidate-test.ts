import {
  buildProgramCandidate,
} from "./program-candidate.ts";
import type {
  ResearchFinding,
  ResearchJob,
} from "./research.ts";

function createSourceJob(): ResearchJob {
  return {
    id: "00000000-0000-4000-8000-000000000920",
    agent: "research",
    task_type: "topic_research",
    status: "running",
    attempts: 1,
    max_attempts: 3,
    payload: {
      request_id:
        "00000000-0000-4000-8000-000000000921",
      language: "ru",
      region: "EU",
      topic_seed: "image enhancement",
      candidate: {
        title: "Example Enhancer",
        url: "https://example.local/enhancer/",
        opportunity_score: 0.8,
        commercial_intent: 0.7,
        content_potential: 0.82,
        referral_potential: 0.9,
        relevance: 0.85,
        evidence_source: "mock",
      },
      recommended_action:
        "investigate_referral_program",
    },
  };
}

function createFinding(
  overrides: Partial<ResearchFinding> = {},
): ResearchFinding {
  return {
    candidate_url:
      "https://example.local/enhancer/#details",
    candidate_title: "Example Enhancer",
    recommendation:
      "investigate_referral_program",
    opportunity_score: 0.8,
    commercial_intent: 0.7,
    content_potential: 0.82,
    referral_potential: 0.9,
    relevance: 0.85,
    evidence_source: "mock",
    research: {
      query: "example enhancer referral program",
      answer: "Example research answer",
      results_count: 1,
      sources: [
        {
          title: "Example affiliate program",
          url:
            "https://example.local/affiliate/",
          content:
            "Referral commission information.",
          score: 0.9,
        },
      ],
    },
    ...overrides,
  };
}

Deno.test(
  "buildProgramCandidate creates a stable contract",
  () => {
    const candidate = buildProgramCandidate(
      createSourceJob(),
      createFinding(),
    );

    if (!candidate) {
      throw new Error("Expected a program candidate");
    }

    if (
      candidate.official_url !==
        "https://example.local/enhancer"
    ) {
      throw new Error("Official URL was not normalized");
    }

    if (
      candidate.affiliate_url !==
        "https://example.local/affiliate"
    ) {
      throw new Error("Affiliate URL was not extracted");
    }

    if (
      candidate._meta.dedupe_key !==
        "program:https://example.local/enhancer"
    ) {
      throw new Error("Unexpected program dedupe key");
    }

    if (
      candidate.request_id !==
        createSourceJob().payload.request_id ||
      candidate.source_job_id !== createSourceJob().id
    ) {
      throw new Error("Source identifiers were not preserved");
    }
  },
);

Deno.test(
  "buildProgramCandidate skips discarded findings",
  () => {
    const candidate = buildProgramCandidate(
      createSourceJob(),
      createFinding({ recommendation: "discard" }),
    );

    if (candidate !== null) {
      throw new Error(
        "Discarded finding must not create a program candidate",
      );
    }
  },
);

Deno.test(
  "buildProgramCandidate requires referral potential",
  () => {
    const candidate = buildProgramCandidate(
      createSourceJob(),
      createFinding({ referral_potential: 0.49 }),
    );

    if (candidate !== null) {
      throw new Error(
        "Low referral potential must be skipped",
      );
    }
  },
);

Deno.test(
  "buildProgramCandidate requires research evidence",
  () => {
    const finding = createFinding();
    finding.research = {
      ...finding.research,
      results_count: 0,
      sources: [],
    };

    const candidate = buildProgramCandidate(
      createSourceJob(),
      finding,
    );

    if (candidate !== null) {
      throw new Error(
        "Finding without sources must be skipped",
      );
    }
  },
);
