export type AttributedEventType =
  | "referral_click"
  | "conversion"
  | "commission";

export type AttributableContent = {
  id: string;
  status: string;
  referral_link_id: string | null;
};

export type AttributionInput = {
  event_type: AttributedEventType;
  occurred_at: string;
  session_id?: string | null;
  country?: string | null;
  language?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown>;
  value?: number | string;
};

export type AttributedEventInsert = {
  event_type: AttributedEventType;
  content_id: string;
  referral_link_id: string;
  session_id: string | null;
  country: string | null;
  language: string | null;
  source: string | null;
  metadata: Record<string, unknown>;
  value: number;
  created_at: string;
};

function requiredString(
  value: string,
  field: string,
): string {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  return normalized;
}

function optionalString(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function normalizeTimestamp(
  value: string,
): string {
  const timestamp = new Date(value);

  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error(
      `Invalid attribution timestamp: ${value}`,
    );
  }

  return timestamp.toISOString();
}

function normalizeValue(
  eventType: AttributedEventType,
  value: number | string | undefined,
): number {
  const normalized = value === undefined
    ? 0
    : Number(value);

  if (!Number.isFinite(normalized)) {
    throw new Error("Attribution value must be a number");
  }

  if (eventType === "commission" && normalized <= 0) {
    throw new Error(
      "Commission attribution value must be positive",
    );
  }

  if (eventType !== "commission" && normalized !== 0) {
    throw new Error(
      `${eventType} attribution value must be zero`,
    );
  }

  return Number(normalized.toFixed(2));
}

export function prepareAttributedEvent(
  content: AttributableContent,
  input: AttributionInput,
): AttributedEventInsert {
  if (content.status !== "published") {
    throw new Error(
      `Attribution requires published content, received: ${content.status}`,
    );
  }

  const contentId = requiredString(
    content.id,
    "Attribution content id",
  );
  const referralLinkId = requiredString(
    content.referral_link_id ?? "",
    "Attribution referral link id",
  );

  return {
    event_type: input.event_type,
    content_id: contentId,
    referral_link_id: referralLinkId,
    session_id: optionalString(input.session_id),
    country: optionalString(input.country)?.toUpperCase() ??
      null,
    language: optionalString(input.language)?.toLowerCase() ??
      null,
    source: optionalString(input.source),
    metadata: { ...(input.metadata ?? {}) },
    value: normalizeValue(
      input.event_type,
      input.value,
    ),
    created_at: normalizeTimestamp(
      input.occurred_at,
    ),
  };
}
