import type {
  ResearchFinding,
  ResearchJob,
} from "./research.ts";

export type ProgramCandidate = {
  request_id: string;
  source_job_id: string;
  name: string;
  official_url: string;
  affiliate_url: string | null;
  status: "candidate";
  countries: string[];
  evidence: {
    recommendation: string;
    evidence_source: string;
    opportunity_score: number;
    commercial_intent: number;
    referral_potential: number;
    relevance: number;
    sources_count: number;
  };
  _meta: {
    dedupe_key: string;
  };
};

function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

function findAffiliateUrl(
  finding: ResearchFinding,
): string | null {
  const affiliatePattern =
    /affiliate|referral|partner|commission/i;

  const source = finding.research.sources.find(
    (item) =>
      affiliatePattern.test(item.title) ||
      affiliatePattern.test(item.url) ||
      affiliatePattern.test(item.content),
  );

  if (!source) {
    return null;
  }

  try {
    return normalizeUrl(source.url);
  } catch {
    return null;
  }
}

export function buildProgramCandidate(
  sourceJob: ResearchJob,
  finding: ResearchFinding,
): ProgramCandidate | null {
  if (
    finding.recommendation !==
      "investigate_referral_program"
  ) {
    return null;
  }

  if (
    finding.referral_potential < 0.5 ||
    finding.research.sources.length === 0
  ) {
    return null;
  }

  const name = finding.candidate_title.trim();

  if (!name) {
    throw new Error("Program candidate name is required");
  }

  let officialUrl: string;

  try {
    officialUrl = normalizeUrl(
      finding.candidate_url,
    );
  } catch {
    throw new Error(
      "Program candidate official URL is invalid",
    );
  }

  return {
    request_id: sourceJob.payload.request_id,
    source_job_id: sourceJob.id,
    name,
    official_url: officialUrl,
    affiliate_url: findAffiliateUrl(finding),
    status: "candidate",
    countries: [sourceJob.payload.region],
    evidence: {
      recommendation: finding.recommendation,
      evidence_source: finding.evidence_source,
      opportunity_score: finding.opportunity_score,
      commercial_intent: finding.commercial_intent,
      referral_potential: finding.referral_potential,
      relevance: finding.relevance,
      sources_count: finding.research.sources.length,
    },
    _meta: {
      dedupe_key: `program:${officialUrl.toLowerCase()}`,
    },
  };
}
