import {
  buildReferralLink,
} from "./referral-link.ts";
import type {
  SavedProgramCandidate,
} from "./referral-link.ts";

function createProgram(
  affiliateUrl: string | null =
    "https://example.local/affiliate/#terms",
): SavedProgramCandidate {
  return {
    id: "00000000-0000-4000-8000-000000000997",
    name: "Example Enhancer",
    official_url:
      "https://example.local/enhancer",
    affiliate_url: affiliateUrl,
    status: "candidate",
  };
}

Deno.test(
  "buildReferralLink creates a paused link",
  () => {
    const program = createProgram();
    const link = buildReferralLink(program);

    if (!link) {
      throw new Error("Expected a referral link");
    }

    if (link.program_id !== program.id) {
      throw new Error("Program ID was not preserved");
    }

    if (
      link.url !== "https://example.local/affiliate"
    ) {
      throw new Error("Referral URL was not normalized");
    }

    if (link.status !== "paused") {
      throw new Error(
        "Unverified referral link must be paused",
      );
    }

    if (link.source !== "research") {
      throw new Error("Referral source was not preserved");
    }
  },
);

Deno.test(
  "buildReferralLink skips missing affiliate URLs",
  () => {
    const link = buildReferralLink(
      createProgram(null),
    );

    if (link !== null) {
      throw new Error(
        "Missing affiliate URL must not create a link",
      );
    }
  },
);

Deno.test(
  "buildReferralLink rejects invalid URLs",
  () => {
    let failed = false;

    try {
      buildReferralLink(
        createProgram("not a valid URL"),
      );
    } catch (error) {
      failed =
        error instanceof Error &&
        error.message === "Referral URL is invalid";
    }

    if (!failed) {
      throw new Error("Invalid referral URL was accepted");
    }
  },
);
