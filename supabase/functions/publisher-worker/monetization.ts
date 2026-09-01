export type MonetizationContent = {
  language?: string;
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

function isRussian(
  language: string | undefined,
): boolean {
  return language?.trim().toLowerCase().startsWith("ru") ??
    false;
}

function disclosureForLanguage(
  language: string | undefined,
): string {
  return isRussian(language)
    ? "\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b \u0441\u043e\u0434\u0435\u0440\u0436\u0438\u0442 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0441\u043a\u0443\u044e \u0441\u0441\u044b\u043b\u043a\u0443. \u041c\u044b \u043c\u043e\u0436\u0435\u043c \u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c \u043a\u043e\u043c\u0438\u0441\u0441\u0438\u044e \u0431\u0435\u0437 \u0434\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c\u043d\u044b\u0445 \u0440\u0430\u0441\u0445\u043e\u0434\u043e\u0432 \u0434\u043b\u044f \u0447\u0438\u0442\u0430\u0442\u0435\u043b\u044f."
    : "This material contains an affiliate link. We may receive a commission at no additional cost to the reader.";
}

function callToActionForLanguage(
  language: string | undefined,
): string {
  return isRussian(language)
    ? "\u041f\u0435\u0440\u0435\u0439\u0442\u0438 \u043d\u0430 \u0441\u0430\u0439\u0442 \u043f\u0430\u0440\u0442\u043d\u0451\u0440\u0430"
    : "Visit the partner website";
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
    disclosure: disclosureForLanguage(
      content.language,
    ),
  };
}

export function renderMonetizedBody(
  body: string,
  placement: MonetizationPlacement,
  language?: string,
): string {
  const normalizedBody = body.trim();

  if (!normalizedBody) {
    throw new Error("Monetization body is required");
  }

  const marker =
    `<!-- vyra-monetization:${placement.referral_link_id} -->`;

  if (normalizedBody.includes(marker)) {
    return normalizedBody;
  }

  const callToAction = callToActionForLanguage(
    language,
  );

  return [
    normalizedBody,
    "---",
    marker,
    `> ${placement.disclosure}`,
    `[${callToAction}](${placement.referral_url})`,
  ].join("\n\n");
}
