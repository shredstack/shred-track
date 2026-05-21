// HTTP helpers for client-side data fetching.
//
// A plain `fetch()` has no timeout: on a flaky connection (e.g. a metal-walled
// gym with poor signal) a request can hang for minutes before the OS gives up.
// `apiFetch` aborts after a hard deadline so callers fail fast and can surface
// a retry affordance instead of an endless spinner.

/** Default request deadline. Long enough for a slow-but-working connection,
 *  short enough that a dead connection fails fast. */
export const DEFAULT_TIMEOUT_MS = 12_000;

/** Thrown when a request times out or the network is unreachable. These are
 *  transient — retrying is worthwhile. */
export class NetworkError extends Error {
  constructor(message = "Network request failed — check your connection.") {
    super(message);
    this.name = "NetworkError";
  }
}

/** Thrown when the server responds with a non-2xx status. Carries `status` so
 *  retry logic can skip un-retryable client errors (4xx). */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiFetchInit extends RequestInit {
  /** Abort the request after this many milliseconds. Defaults to
   *  {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * `fetch` with a hard timeout. Behaves like `fetch` (returns the raw
 * `Response`, does not throw on non-2xx), but rejects with {@link NetworkError}
 * if the request exceeds `timeoutMs` or the connection drops.
 *
 * An upstream `signal` (e.g. React Query cancelling a stale query) is honored
 * and propagated as a normal `AbortError` so it is treated as a cancellation,
 * not a failure.
 */
export async function apiFetch(
  input: string,
  init: ApiFetchInit = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Collapse an upstream abort (caller cancellation) into our controller so
  // there is a single signal driving the request.
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    // A genuine caller cancellation should propagate untouched.
    if (signal?.aborted) throw err;
    throw new NetworkError(
      controller.signal.aborted
        ? "Request timed out — check your connection."
        : "Network request failed — check your connection.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `apiFetch` plus status checking and JSON parsing. Throws {@link ApiError}
 * (with the server's `error` message when present) on a non-2xx response, or
 * {@link NetworkError} on timeout/offline. Intended for React Query `queryFn`s.
 */
export async function fetchJson<T>(
  input: string,
  init?: ApiFetchInit,
): Promise<T> {
  const res = await apiFetch(input, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new ApiError(
      body?.error || `Request failed (${res.status})`,
      res.status,
    );
  }
  return res.json() as Promise<T>;
}
