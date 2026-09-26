import { fetchWithTimeout } from "./fetch-with-timeout.ts";

Deno.test("external request aborts when its time budget expires", async () => {
  let sawAbort = false;
  // Keep the test event loop active while a mocked fetch has no network I/O.
  const keepAlive = setTimeout(() => {}, 100);
  const stalledFetch: typeof fetch = (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Timeout signal was not provided");
      signal.addEventListener("abort", () => {
        sawAbort = true;
        reject(signal.reason);
      }, { once: true });
    });

  try {
    await fetchWithTimeout("https://example.local/slow", {}, 10, stalledFetch);
    throw new Error("Stalled request unexpectedly completed");
  } catch (error) {
    if (!sawAbort || !(error instanceof DOMException) || error.name !== "TimeoutError") {
      throw new Error("Stalled request did not stop at its time budget");
    }
  } finally {
    clearTimeout(keepAlive);
  }
});
