import {
  createSupabaseAdminClient,
} from "./supabase-job-store.ts";

export type CostProvider = "openai" | "tavily";

export type CostOperation =
  | "content_draft"
  | "content_revision"
  | "research_worker_search"
  | "topic_scout_search";

type ReservationStatus =
  | "reserved"
  | "in_flight"
  | "settled"
  | "released"
  | "manual_review";

type Reservation = {
  id: string;
  status: ReservationStatus;
};

type ProviderCheckpoint = Reservation & {
  providerResult: unknown;
};

type CostProtectedProviderCall<T> = {
  jobId: string;
  provider: CostProvider;
  operation: CostOperation;
  reservedEurMicros: number;
  execute: () => Promise<T>;
  restore: (value: unknown) => T;
};

export type CostProtectedProviderCallResult<T> = {
  result: T;
  reservationId: string;
  reusedCheckpoint: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("VYRA cost RPC returned an invalid response");
  }

  return value as Record<string, unknown>;
}

function singleRpcRow(
  data: unknown,
  operation: string,
): Record<string, unknown> {
  const rows = Array.isArray(data) ? data : [data];

  if (rows.length !== 1) {
    throw new Error(
      `VYRA cost RPC ${operation} returned ${rows.length} rows`,
    );
  }

  return asRecord(rows[0]);
}

function readReservation(
  data: unknown,
  operation: string,
): Reservation {
  const row = singleRpcRow(data, operation);
  const id = row.id;
  const status = row.status;

  if (typeof id !== "string" || !id) {
    throw new Error(`VYRA cost RPC ${operation} returned no id`);
  }

  if (
    status !== "reserved" &&
    status !== "in_flight" &&
    status !== "settled" &&
    status !== "released" &&
    status !== "manual_review"
  ) {
    throw new Error(
      `VYRA cost RPC ${operation} returned invalid status`,
    );
  }

  return { id, status };
}

function readProviderCheckpoint(
  data: unknown,
): ProviderCheckpoint {
  const row = singleRpcRow(
    data,
    "load_vyra_cost_provider_result",
  );

  const reservation = readReservation(
    row,
    "load_vyra_cost_provider_result",
  );

  if (reservation.status !== "settled") {
    throw new Error(
      "VYRA provider checkpoint is not settled",
    );
  }

  if (row.provider_result === null || row.provider_result === undefined) {
    throw new Error(
      "VYRA settled provider checkpoint has no saved result",
    );
  }

  return {
    ...reservation,
    providerResult: row.provider_result,
  };
}

function toJsonValue(value: unknown): unknown {
  const serialized = JSON.stringify(value);

  if (!serialized) {
    throw new Error(
      "VYRA provider result cannot be checkpointed as JSON",
    );
  }

  return JSON.parse(serialized);
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

async function callCostRpc(
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const client = createSupabaseAdminClient();

  const { data, error } = await client.rpc(
    functionName,
    args,
  );

  if (error) {
    throw new Error(
      `VYRA cost RPC ${functionName} failed: ${error.message}`,
    );
  }

  return data;
}

async function reserveCostBudget(
  jobId: string,
  provider: CostProvider,
  operation: CostOperation,
  reservedEurMicros: number,
): Promise<Reservation> {
  return readReservation(
    await callCostRpc(
      "reserve_vyra_cost_budget",
      {
        p_job_id: jobId,
        p_provider: provider,
        p_operation: operation,
        p_reserved_eur_micros: reservedEurMicros,
      },
    ),
    "reserve_vyra_cost_budget",
  );
}

async function beginProviderCall(
  reservationId: string,
): Promise<Reservation> {
  return readReservation(
    await callCostRpc(
      "begin_vyra_cost_provider_call",
      { p_reservation_id: reservationId },
    ),
    "begin_vyra_cost_provider_call",
  );
}

async function checkpointProviderResult(
  reservationId: string,
  providerResult: unknown,
): Promise<Reservation> {
  return readReservation(
    await callCostRpc(
      "checkpoint_vyra_cost_provider_result",
      {
        p_reservation_id: reservationId,
        p_provider_result: toJsonValue(providerResult),
      },
    ),
    "checkpoint_vyra_cost_provider_result",
  );
}

async function loadProviderResult(
  reservationId: string,
): Promise<ProviderCheckpoint> {
  return readProviderCheckpoint(
    await callCostRpc(
      "load_vyra_cost_provider_result",
      { p_reservation_id: reservationId },
    ),
  );
}

async function markManualReview(
  reservationId: string,
  reason: string,
): Promise<void> {
  await callCostRpc(
    "mark_vyra_cost_reservation_manual_review",
    {
      p_reservation_id: reservationId,
      p_reason: reason,
    },
  );
}

export function readPositiveEurMicros(
  environmentName: string,
): number {
  const value = Deno.env.get(environmentName)?.trim();
  const parsed = Number(value);

  if (
    !value ||
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(
      `${environmentName} must be a positive integer in EUR micros`,
    );
  }

  return parsed;
}

export async function runCostProtectedProviderCall<T>(
  options: CostProtectedProviderCall<T>,
): Promise<CostProtectedProviderCallResult<T>> {
  const reservation = await reserveCostBudget(
    options.jobId,
    options.provider,
    options.operation,
    options.reservedEurMicros,
  );

  if (reservation.status === "settled") {
    const checkpoint = await loadProviderResult(
      reservation.id,
    );

    return {
      result: options.restore(checkpoint.providerResult),
      reservationId: reservation.id,
      reusedCheckpoint: true,
    };
  }

  if (reservation.status === "manual_review") {
    throw new Error(
      "VYRA provider call requires manual review; no new paid request was sent",
    );
  }

  if (reservation.status === "in_flight") {
    await markManualReview(
      reservation.id,
      "A retry found an interrupted paid provider call",
    );

    throw new Error(
      "VYRA provider call was moved to manual review; no new paid request was sent",
    );
  }

  if (reservation.status !== "reserved") {
    throw new Error(
      `VYRA provider call cannot start from ${reservation.status}`,
    );
  }

  const started = await beginProviderCall(reservation.id);

  if (started.status !== "in_flight") {
    throw new Error(
      `VYRA provider call did not enter in_flight: ${started.status}`,
    );
  }

  let result: T;

  try {
    result = await options.execute();
  } catch (error) {
    const reason = errorMessage(error);

    try {
      await markManualReview(
        reservation.id,
        `Provider call failed after dispatch: ${reason}`,
      );
    } catch (reviewError) {
      console.error(
        "VYRA provider-call review marker failed",
        reviewError,
      );
    }

    throw new Error(
      `Paid provider call was retained for manual review: ${reason}`,
    );
  }

  await checkpointProviderResult(
    reservation.id,
    result,
  );

  return {
    result,
    reservationId: reservation.id,
    reusedCheckpoint: false,
  };
}