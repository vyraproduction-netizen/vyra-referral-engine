import {
  resolveContentCandidateUrl,
  selectMonetizationPlacement,
} from "./monetization.ts";
import type {
  MonetizationContent,
  MonetizationProgram,
  MonetizationReferralLink,
} from "./monetization.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const content: MonetizationContent = {
  evidence: {
    candidate: {
      url: "https://Example.Local/program/",
    },
  },
};

const program: MonetizationProgram = {
  id: "00000000-0000-4000-8000-000000001300",
  official_url: "https://example.local/program",
  status: "active",
  terms_verified: true,
};

const link: MonetizationReferralLink = {
  id: "00000000-0000-4000-8000-000000001301",
  program_id: program.id,
  url: "https://example.local/referral?campaign=vyra",
  source: "verified_activation",
  status: "active",
};

Deno.test(
  "resolves the candidate URL from content evidence",
  () => {
    assert(
      resolveContentCandidateUrl(content) ===
        "https://example.local/program",
      "Candidate URL was not normalized",
    );
  },
);

Deno.test(
  "selects an active verified program and active link",
  () => {
    const placement = selectMonetizationPlacement(
      content,
      [program],
      [link],
    );

    assert(placement, "Expected a placement");
    assert(
      placement.program_id === program.id,
      "Program id mismatch",
    );
    assert(
      placement.referral_link_id === link.id,
      "Referral link id mismatch",
    );
  },
);

Deno.test(
  "rejects a program without verified terms",
  () => {
    const placement = selectMonetizationPlacement(
      content,
      [{ ...program, terms_verified: false }],
      [link],
    );

    assert(
      placement === null,
      "Unverified program was selected",
    );
  },
);

Deno.test(
  "rejects a paused referral link",
  () => {
    const placement = selectMonetizationPlacement(
      content,
      [program],
      [{ ...link, status: "paused" }],
    );

    assert(
      placement === null,
      "Paused referral link was selected",
    );
  },
);

Deno.test(
  "rejects a link belonging to another program",
  () => {
    const placement = selectMonetizationPlacement(
      content,
      [program],
      [{
        ...link,
        program_id:
          "00000000-0000-4000-8000-000000001399",
      }],
    );

    assert(
      placement === null,
      "Foreign referral link was selected",
    );
  },
);

Deno.test(
  "prefers the verified activation link deterministically",
  () => {
    const placement = selectMonetizationPlacement(
      content,
      [program],
      [
        {
          ...link,
          id: "00000000-0000-4000-8000-000000001302",
          source: "research",
        },
        link,
      ],
    );

    assert(placement, "Expected a placement");
    assert(
      placement.referral_link_id === link.id,
      "Verified activation link was not preferred",
    );
  },
);
