import {
  prepareAttributedEvent,
} from "./attribution.ts";
import type {
  AttributableContent,
  AttributionInput,
} from "./attribution.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const content: AttributableContent = {
  id: "00000000-0000-4000-8000-000000001600",
  status: "published",
  referral_link_id:
    "00000000-0000-4000-8000-000000001601",
};

function input(
  eventType: AttributionInput["event_type"],
  value: number | string = 0,
): AttributionInput {
  return {
    event_type: eventType,
    occurred_at: "2026-09-01T18:00:00Z",
    session_id: " session-1 ",
    country: "gr",
    language: "RU",
    source: " published-content ",
    metadata: {
      placement: "body",
    },
    value,
  };
}

Deno.test(
  "prepares a referral click for published content",
  () => {
    const event = prepareAttributedEvent(
      content,
      input("referral_click"),
    );

    assert(
      event.content_id === content.id,
      "Content id mismatch",
    );
    assert(
      event.referral_link_id ===
        content.referral_link_id,
      "Referral link id mismatch",
    );
    assert(event.country === "GR", "Country mismatch");
    assert(event.language === "ru", "Language mismatch");
    assert(
      event.created_at ===
        "2026-09-01T18:00:00.000Z",
      "Timestamp mismatch",
    );
  },
);

Deno.test(
  "prepares a conversion with zero value",
  () => {
    const event = prepareAttributedEvent(
      content,
      input("conversion"),
    );

    assert(event.value === 0, "Conversion value mismatch");
  },
);

Deno.test(
  "prepares a positive commission",
  () => {
    const event = prepareAttributedEvent(
      content,
      input("commission", "12.345"),
    );

    assert(event.value === 12.35, "Commission mismatch");
  },
);

Deno.test(
  "rejects attribution for unpublished content",
  () => {
    let rejected = false;

    try {
      prepareAttributedEvent(
        { ...content, status: "approved" },
        input("referral_click"),
      );
    } catch {
      rejected = true;
    }

    assert(rejected, "Unpublished content was accepted");
  },
);

Deno.test(
  "rejects content without a referral link",
  () => {
    let rejected = false;

    try {
      prepareAttributedEvent(
        { ...content, referral_link_id: null },
        input("referral_click"),
      );
    } catch {
      rejected = true;
    }

    assert(rejected, "Missing referral link was accepted");
  },
);

Deno.test(
  "rejects a non-positive commission",
  () => {
    let rejected = false;

    try {
      prepareAttributedEvent(
        content,
        input("commission", 0),
      );
    } catch {
      rejected = true;
    }

    assert(rejected, "Zero commission was accepted");
  },
);

Deno.test(
  "rejects value on a referral click",
  () => {
    let rejected = false;

    try {
      prepareAttributedEvent(
        content,
        input("referral_click", 1),
      );
    } catch {
      rejected = true;
    }

    assert(rejected, "Referral click value was accepted");
  },
);

Deno.test(
  "rejects an invalid attribution timestamp",
  () => {
    let rejected = false;

    try {
      prepareAttributedEvent(
        content,
        {
          ...input("conversion"),
          occurred_at: "not-a-date",
        },
      );
    } catch {
      rejected = true;
    }

    assert(rejected, "Invalid timestamp was accepted");
  },
);
