import {
  prepareControllerAttributionRequest,
} from "./analytics-attribution.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function request() {
  return {
    action: "record_analytics_event",
    content_id:
      " 00000000-0000-4000-8000-000000001800 ",
    dedupe_key: " runtime:event:1 ",
    event_type: "referral_click",
    occurred_at: "2026-09-01T19:00:00Z",
    session_id: "session-1",
    country: "GR",
    language: "ru",
    source: "published-content",
    metadata: {
      placement: "body",
    },
    value: 0,
  };
}

Deno.test(
  "prepares a controller attribution request",
  () => {
    const result =
      prepareControllerAttributionRequest(request());

    assert(
      result.content_id ===
        "00000000-0000-4000-8000-000000001800",
      "Content id was not normalized",
    );
    assert(
      result.attribution.dedupe_key ===
        "runtime:event:1",
      "Dedupe key was not normalized",
    );
    assert(
      result.attribution.event_type ===
        "referral_click",
      "Event type mismatch",
    );
  },
);

Deno.test(
  "accepts conversion and commission events",
  () => {
    for (const eventType of [
      "conversion",
      "commission",
    ]) {
      const result = prepareControllerAttributionRequest({
        ...request(),
        event_type: eventType,
      });

      assert(
        result.attribution.event_type === eventType,
        `Event type mismatch: ${eventType}`,
      );
    }
  },
);

Deno.test(
  "rejects an unsupported event type",
  () => {
    let rejected = false;

    try {
      prepareControllerAttributionRequest({
        ...request(),
        event_type: "view",
      });
    } catch {
      rejected = true;
    }

    assert(rejected, "Unsupported event type was accepted");
  },
);

Deno.test(
  "rejects a missing content id",
  () => {
    let rejected = false;

    try {
      prepareControllerAttributionRequest({
        ...request(),
        content_id: " ",
      });
    } catch {
      rejected = true;
    }

    assert(rejected, "Missing content id was accepted");
  },
);

Deno.test(
  "rejects a missing dedupe key",
  () => {
    let rejected = false;

    try {
      prepareControllerAttributionRequest({
        ...request(),
        dedupe_key: " ",
      });
    } catch {
      rejected = true;
    }

    assert(rejected, "Missing dedupe key was accepted");
  },
);

Deno.test(
  "rejects non-object metadata",
  () => {
    let rejected = false;

    try {
      prepareControllerAttributionRequest({
        ...request(),
        metadata: [],
      });
    } catch {
      rejected = true;
    }

    assert(rejected, "Invalid metadata was accepted");
  },
);
