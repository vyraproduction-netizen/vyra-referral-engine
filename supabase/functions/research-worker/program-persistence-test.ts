import {
  prepareProgramInsert,
} from "./program-persistence.ts";
import type {
  ProgramCandidate,
} from "./program-candidate.ts";

function createCandidate(): ProgramCandidate {
  return {
    request_id:
      "00000000-0000-4000-8000-000000000921",
    source_job_id:
      "00000000-0000-4000-8000-000000000920",
    name: "Example Enhancer",
    official_url:
      "https://example.local/enhancer",
    affiliate_url:
      "https://example.local/affiliate",
    status: "candidate",
    countries: ["EU"],
    evidence: {
      recommendation:
        "investigate_referral_program",
      evidence_source: "mock",
      opportunity_score: 0.8,
      commercial_intent: 0.7,
      referral_potential: 0.9,
      relevance: 0.85,
      sources_count: 1,
    },
    _meta: {
      dedupe_key:
        "program:https://example.local/enhancer",
    },
  };
}

Deno.test(
  "prepareProgramInsert maps candidate fields",
  () => {
    const candidate = createCandidate();
    const row = prepareProgramInsert(candidate);

    if (row.name !== candidate.name) {
      throw new Error("Program name was not preserved");
    }

    if (row.official_url !== candidate.official_url) {
      throw new Error("Official URL was not preserved");
    }

    if (row.affiliate_url !== candidate.affiliate_url) {
      throw new Error("Affiliate URL was not preserved");
    }

    if (
      row.status !== "candidate" ||
      row.countries[0] !== "EU"
    ) {
      throw new Error("Program state was not preserved");
    }
  },
);

Deno.test(
  "prepareProgramInsert preserves trace metadata",
  () => {
    const candidate = createCandidate();
    const row = prepareProgramInsert(candidate);
    const notes = JSON.parse(row.notes);

    if (notes.request_id !== candidate.request_id) {
      throw new Error("Request ID was not preserved");
    }

    if (
      notes.source_job_id !== candidate.source_job_id
    ) {
      throw new Error("Source job ID was not preserved");
    }

    if (
      notes.dedupe_key !==
        candidate._meta.dedupe_key
    ) {
      throw new Error("Dedupe key was not preserved");
    }

    if (notes.evidence.sources_count !== 1) {
      throw new Error("Evidence was not preserved");
    }
  },
);
