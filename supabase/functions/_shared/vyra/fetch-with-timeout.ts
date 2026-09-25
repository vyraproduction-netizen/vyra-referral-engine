/** Bound an external request, including reading its response body. */
export function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("External request timeout must be a positive integer");
  }

  return fetchImpl(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
