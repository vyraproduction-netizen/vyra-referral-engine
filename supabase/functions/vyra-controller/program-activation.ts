export type CommissionType =
  | "percentage"
  | "fixed"
  | "cpa"
  | "cpl"
  | "revenue_share";

export type ProgramActivationInput = {
  program_id: string;
  affiliate_url: string;
  terms_url: string;
  commission_type: string;
  commission_value: number;
  recurring: boolean;
  cookie_duration_days: number;
  countries: string[];
  verified_by: string;
  verification_note?: string;
};

export type PreparedProgramActivation = {
  program_id: string;
  affiliate_url: string;
  terms_url: string;
  commission_type: CommissionType;
  commission_value: number;
  recurring: boolean;
  cookie_duration_days: number;
  countries: string[];
  verified_by: string;
  verification_note: string | null;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const commissionTypes = new Set<CommissionType>([
  "percentage",
  "fixed",
  "cpa",
  "cpl",
  "revenue_share",
]);

function normalizeHttpsUrl(
  value: string,
  field: string,
): string {
  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`${field} must be a valid URL`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${field} must use HTTPS`);
  }

  url.hash = "";

  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  return url.toString();
}

function normalizeCountries(
  countries: string[],
): string[] {
  const normalized = [
    ...new Set(
      countries
        .map((country) => country.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];

  if (normalized.length === 0) {
    throw new Error("countries must not be empty");
  }

  return normalized;
}

export function prepareProgramActivation(
  input: ProgramActivationInput,
): PreparedProgramActivation {
  if (!uuidPattern.test(input.program_id)) {
    throw new Error("program_id must be a valid UUID");
  }

  const commissionType =
    input.commission_type.trim().toLowerCase() as
      CommissionType;

  if (!commissionTypes.has(commissionType)) {
    throw new Error("commission_type is unsupported");
  }

  if (
    !Number.isFinite(input.commission_value) ||
    input.commission_value < 0
  ) {
    throw new Error(
      "commission_value must be a non-negative number",
    );
  }

  if (
    (commissionType === "percentage" ||
      commissionType === "revenue_share") &&
    input.commission_value > 100
  ) {
    throw new Error(
      "percentage commission_value must not exceed 100",
    );
  }

  if (
    !Number.isInteger(input.cookie_duration_days) ||
    input.cookie_duration_days < 0 ||
    input.cookie_duration_days > 3650
  ) {
    throw new Error(
      "cookie_duration_days must be an integer from 0 to 3650",
    );
  }

  const verifiedBy = input.verified_by.trim();

  if (!verifiedBy || verifiedBy.length > 100) {
    throw new Error(
      "verified_by must contain 1 to 100 characters",
    );
  }

  const verificationNote =
    input.verification_note?.trim() || null;

  if (
    verificationNote &&
    verificationNote.length > 1000
  ) {
    throw new Error(
      "verification_note must not exceed 1000 characters",
    );
  }

  return {
    program_id: input.program_id.toLowerCase(),
    affiliate_url: normalizeHttpsUrl(
      input.affiliate_url,
      "affiliate_url",
    ),
    terms_url: normalizeHttpsUrl(
      input.terms_url,
      "terms_url",
    ),
    commission_type: commissionType,
    commission_value: input.commission_value,
    recurring: input.recurring,
    cookie_duration_days:
      input.cookie_duration_days,
    countries: normalizeCountries(input.countries),
    verified_by: verifiedBy,
    verification_note: verificationNote,
  };
}
