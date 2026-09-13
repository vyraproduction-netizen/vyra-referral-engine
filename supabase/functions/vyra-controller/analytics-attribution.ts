import type {
  AttributionInput,
  AttributedEventType,
} from "../analytics-worker/attribution.ts";

export type ControllerAttributionRequest = {
  content_id: string;
  attribution: AttributionInput;
};

const allowedEventTypes = new Set<AttributedEventType>([
  "referral_click",
  "conversion",
  "commission",
]);

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

function optionalString(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value;
}

export function prepareControllerAttributionRequest(
  value: unknown,
): ControllerAttributionRequest {
  if (!isRecord(value)) {
    throw new Error(
      "Analytics attribution request is required",
    );
  }

  const eventType = requiredString(
    value.event_type,
    "event_type",
  ) as AttributedEventType;

  if (!allowedEventTypes.has(eventType)) {
    throw new Error(
      `Unsupported attributed event_type: ${eventType}`,
    );
  }

  if (
    value.metadata !== undefined &&
    !isRecord(value.metadata)
  ) {
    throw new Error("metadata must be an object");
  }

  if (
    value.value !== undefined &&
    typeof value.value !== "number" &&
    typeof value.value !== "string"
  ) {
    throw new Error("value must be a number or string");
  }

  return {
    content_id: requiredString(
      value.content_id,
      "content_id",
    ),
    attribution: {
      dedupe_key: requiredString(
        value.dedupe_key,
        "dedupe_key",
      ),
      event_type: eventType,
      occurred_at: requiredString(
        value.occurred_at,
        "occurred_at",
      ),
      session_id: optionalString(
        value.session_id,
        "session_id",
      ),
      country: optionalString(
        value.country,
        "country",
      ),
      language: optionalString(
        value.language,
        "language",
      ),
      source: optionalString(
        value.source,
        "source",
      ),
      metadata: value.metadata as
        | Record<string, unknown>
        | undefined,
      value: value.value as
        | number
        | string
        | undefined,
    },
  };
}
