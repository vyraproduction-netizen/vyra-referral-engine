export type SavedProgramCandidate = {
  id: string;
  name: string;
  official_url: string;
  affiliate_url: string | null;
  status: string;
};

export type ReferralLinkInsertRow = {
  program_id: string;
  name: string;
  url: string;
  source: "research";
  placement: null;
  status: "paused";
};

function normalizeUrl(value: string): string {
  const url = new URL(value.trim());
  url.hash = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

export function buildReferralLink(
  program: SavedProgramCandidate,
): ReferralLinkInsertRow | null {
  if (!program.affiliate_url) {
    return null;
  }

  let referralUrl: string;

  try {
    referralUrl = normalizeUrl(
      program.affiliate_url,
    );
  } catch {
    throw new Error("Referral URL is invalid");
  }

  return {
    program_id: program.id,
    name: `${program.name} referral`,
    url: referralUrl,
    source: "research",
    placement: null,
    status: "paused",
  };
}
