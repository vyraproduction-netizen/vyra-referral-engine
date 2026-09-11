import {
  prepareProgramActivation,
} from "./program-activation.ts";
import type {
  ProgramActivationInput,
} from "./program-activation.ts";

function createInput(
  overrides: Partial<ProgramActivationInput> = {},
): ProgramActivationInput {
  return {
    program_id:
      "00000000-0000-4000-8000-000000001100",
    affiliate_url:
      "https://partner.example/track?id=vyra#details",
    terms_url:
      "https://partner.example/terms/",
    commission_type: "percentage",
    commission_value: 20,
    recurring: true,
    cookie_duration_days: 30,
    countries: ["eu", " EU ", "gr"],
    verified_by: "vyra-owner",
    verification_note: "Terms checked manually",
    ...overrides,
  };
}

Deno.test(
  "prepareProgramActivation creates a stable contract",
  () => {
    const result = prepareProgramActivation(
      createInput(),
    );

    if (
      result.affiliate_url !==
        "https://partner.example/track?id=vyra"
    ) {
      throw new Error("Affiliate URL was not normalized");
    }

    if (
      result.terms_url !==
        "https://partner.example/terms"
    ) {
      throw new Error("Terms URL was not normalized");
    }

    if (result.countries.join(",") !== "EU,GR") {
      throw new Error("Countries were not normalized");
    }

    if (
      result.verified_by !== "vyra-owner" ||
      result.verification_note !==
        "Terms checked manually"
    ) {
      throw new Error("Verification audit was not preserved");
    }
  },
);

Deno.test(
  "prepareProgramActivation requires HTTPS",
  () => {
    let failed = false;

    try {
      prepareProgramActivation(
        createInput({
          affiliate_url:
            "http://partner.example/track",
        }),
      );
    } catch (error) {
      failed =
        error instanceof Error &&
        error.message ===
          "affiliate_url must use HTTPS";
    }

    if (!failed) {
      throw new Error("Insecure affiliate URL was accepted");
    }
  },
);

Deno.test(
  "prepareProgramActivation limits percentages",
  () => {
    let failed = false;

    try {
      prepareProgramActivation(
        createInput({ commission_value: 101 }),
      );
    } catch (error) {
      failed =
        error instanceof Error &&
        error.message ===
          "percentage commission_value must not exceed 100";
    }

    if (!failed) {
      throw new Error("Invalid percentage was accepted");
    }
  },
);

Deno.test(
  "prepareProgramActivation validates the program id",
  () => {
    let failed = false;

    try {
      prepareProgramActivation(
        createInput({ program_id: "not-a-uuid" }),
      );
    } catch (error) {
      failed =
        error instanceof Error &&
        error.message ===
          "program_id must be a valid UUID";
    }

    if (!failed) {
      throw new Error("Invalid program id was accepted");
    }
  },
);

Deno.test(
  "prepareProgramActivation requires an audit identity",
  () => {
    let failed = false;

    try {
      prepareProgramActivation(
        createInput({ verified_by: "   " }),
      );
    } catch (error) {
      failed =
        error instanceof Error &&
        error.message ===
          "verified_by must contain 1 to 100 characters";
    }

    if (!failed) {
      throw new Error("Missing verification identity was accepted");
    }
  },
);
