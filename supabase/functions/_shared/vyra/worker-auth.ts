export const VYRA_WORKER_SECRET_HEADER = "x-vyra-worker-secret";

export type WorkerAuthorizationResult =
  | { ok: true }
  | {
    ok: false;
    status: 401 | 405 | 500;
    error: string;
  };

function secretsMatch(
  suppliedSecret: string,
  expectedSecret: string,
): boolean {
  const encoder = new TextEncoder();
  const supplied = encoder.encode(suppliedSecret);
  const expected = encoder.encode(expectedSecret);
  const length = Math.max(supplied.length, expected.length);
  let difference = supplied.length ^ expected.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (supplied[index] ?? 0) ^
      (expected[index] ?? 0);
  }

  return difference === 0;
}

export function authorizeWorkerRequest(
  request: Request,
  configuredSecret: string | undefined,
): WorkerAuthorizationResult {
  if (!configuredSecret?.trim()) {
    return {
      ok: false,
      status: 500,
      error: "VYRA_WORKER_SECRET is required",
    };
  }

  if (request.method !== "POST") {
    return {
      ok: false,
      status: 405,
      error: "Method not allowed",
    };
  }

  const suppliedSecret = request.headers.get(
    VYRA_WORKER_SECRET_HEADER,
  );

  if (
    suppliedSecret === null ||
    !secretsMatch(suppliedSecret, configuredSecret)
  ) {
    return {
      ok: false,
      status: 401,
      error: "Unauthorized worker request",
    };
  }

  return { ok: true };
}
