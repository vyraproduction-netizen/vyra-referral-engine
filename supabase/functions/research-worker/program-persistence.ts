import type {
  ProgramCandidate,
} from "./program-candidate.ts";

export type ProgramInsertRow = {
  name: string;
  official_url: string;
  affiliate_url: string | null;
  status: "candidate";
  countries: string[];
  notes: string;
};

export function prepareProgramInsert(
  candidate: ProgramCandidate,
): ProgramInsertRow {
  return {
    name: candidate.name,
    official_url: candidate.official_url,
    affiliate_url: candidate.affiliate_url,
    status: candidate.status,
    countries: candidate.countries,
    notes: JSON.stringify({
      request_id: candidate.request_id,
      source_job_id: candidate.source_job_id,
      evidence: candidate.evidence,
      dedupe_key: candidate._meta.dedupe_key,
    }),
  };
}
