import {
  authorizeWorkerRequest,
  VYRA_WORKER_SECRET_HEADER,
} from "./worker-auth.ts";

function assert(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function request(
  method = "POST",
  secret?: string,
): Request {
  const headers = new Headers();

  if (secret !== undefined) {
    headers.set(VYRA_WORKER_SECRET_HEADER, secret);
  }

  return new Request("https://example.local/worker", {
    method,
    headers,
  });
}

Deno.test(
  "worker authorization accepts a matching internal secret",
  () => {
    const result = authorizeWorkerRequest(
      request("POST", "internal-secret"),
      "internal-secret",
    );

    assert(result.ok, "Matching worker secret was rejected");
  },
);

Deno.test(
  "worker authorization rejects a missing request secret",
  () => {
    const result = authorizeWorkerRequest(
      request(),
      "internal-secret",
    );

    assert(!result.ok, "Missing worker secret was accepted");
    assert(result.status === 401, "Expected HTTP 401");
  },
);

Deno.test(
  "worker authorization rejects an incorrect request secret",
  () => {
    const result = authorizeWorkerRequest(
      request("POST", "incorrect-secret"),
      "internal-secret",
    );

    assert(!result.ok, "Incorrect worker secret was accepted");
    assert(result.status === 401, "Expected HTTP 401");
  },
);

Deno.test(
  "worker authorization rejects a secret with a matching prefix",
  () => {
    const result = authorizeWorkerRequest(
      request("POST", "internal-secret-extra"),
      "internal-secret",
    );

    assert(!result.ok, "Worker secret prefix was accepted");
  },
);

Deno.test(
  "worker authorization fails closed without configuration",
  () => {
    const result = authorizeWorkerRequest(
      request("POST", "internal-secret"),
      undefined,
    );

    assert(!result.ok, "Missing configuration was accepted");
    assert(result.status === 500, "Expected HTTP 500");
  },
);

Deno.test(
  "worker authorization rejects non-POST requests",
  () => {
    const result = authorizeWorkerRequest(
      request("GET", "internal-secret"),
      "internal-secret",
    );

    assert(!result.ok, "GET worker request was accepted");
    assert(result.status === 405, "Expected HTTP 405");
  },
);
