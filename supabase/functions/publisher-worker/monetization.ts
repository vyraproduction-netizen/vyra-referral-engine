export type MonetizationContent = {
  evidence: Record<string, unknown>;
};

export type MonetizationProgram = {
  id: string;
  official_url: string;
  status: string;
  terms_verified: boolean;
};

export type MonetizationReferralLink = {
  id: string;
  program_id: string;
  url: string;
  source: string | null;
  status: string;
};

export type MonetizationPlacement = {
  program_id: string;
  referral_link_id: string;
  referral_url: string;
  disclosure: string;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function normalizeHttpsUrl(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  try {
    const url = new URL(value.trim());

    if (url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();

    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function resolveContentCandidateUrl(
  content: MonetizationContent,
): string | null {
  const candidate = content.evidence.candidate;

  if (isRecord(candidate)) {
    return normalizeHttpsUrl(candidate.url);
  }

  return normalizeHttpsUrl(
    content.evidence.candidate_url,
  );
}

function linkPriority(
  link: MonetizationReferralLink,
): number {
  return link.source === "verified_activation" ? 0 : 1;
}

export function selectMonetizationPlacement(
  content: MonetizationContent,
  programs: MonetizationProgram[],
  referralLinks: MonetizationReferralLink[],
): MonetizationPlacement | null {
  const candidateUrl = resolveContentCandidateUrl(
    content,
  );

  if (!candidateUrl) {
    return null;
  }

  const program = programs.find((item) =>
    item.status === "active" &&
    item.terms_verified &&
    normalizeHttpsUrl(item.official_url) ===
      candidateUrl
  );

  if (!program) {
    return null;
  }

  const link = referralLinks
    .filter((item) =>
      item.program_id === program.id &&
      item.status === "active" &&
      normalizeHttpsUrl(item.url) !== null
    )
    .sort((left, right) =>
      linkPriority(left) - linkPriority(right) ||
      left.id.localeCompare(right.id)
    )[0];

  const referralUrl = link
    ? normalizeHttpsUrl(link.url)
    : null;

  if (!link || !referralUrl) {
    return null;
  }

  return {
    program_id: program.id,
    referral_link_id: link.id,
    referral_url: referralUrl,
    disclosure:
      "Материал содержит партнёрскую ссылку. Мы можем получить комиссию без дополнительных расходов для читателя.",
  };
}
