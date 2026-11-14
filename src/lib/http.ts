/**
 * Provider HTTP client with explicit deadlines and bounded retries.
 *
 * Every attempt gets its own AbortSignal.timeout(), combined with the caller's
 * cancellation signal, and the response body is consumed inside the attempt so
 * a stalled body counts against the same deadline. Retries are limited to
 * transient failures (timeouts, network errors, 429 and 5xx).
 */
export type ProviderErrorKind =
  | "timeout"
  | "network"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "server"
  | "bad_request"
  | "bad_response"
  | "cancelled";

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  readonly host: string;
  readonly attempts: number;

  constructor(kind: ProviderErrorKind, message: string, host: string, attempts: number, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.host = host;
    this.attempts = attempts;
    this.status = status;
  }

  get retryable(): boolean {
    return isRetryableKind(this.kind);
  }
}

export interface RequestPolicy {
  /** Deadline for one attempt, including reading the body. */
  timeoutMs: number;
  /** Extra attempts after the first one. */
  retries: number;
  /** Base backoff between attempts; doubled each time, with jitter. */
  backoffMs?: number;
  /** Caller cancellation (run cancelled, time budget exhausted). */
  signal?: AbortSignal;
}

export const DEFAULT_POLICY: RequestPolicy = { timeoutMs: 60_000, retries: 2, backoffMs: 750 };

export interface RequestResult<T> {
  value: T;
  status: number;
  attempts: number;
  durationMs: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function isRetryableKind(kind: ProviderErrorKind): boolean {
  return kind === "timeout" || kind === "network" || kind === "rate_limited" || kind === "server";
}

export function classifyStatus(status: number): ProviderErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? Math.min(seconds * 1000, 10_000) : undefined;
}

/**
 * Performs a request under a policy and parses the body inside the attempt.
 * Throws ProviderError with a classified kind on final failure.
 */
export async function requestWithPolicy<T>(
  url: string,
  init: RequestInit,
  policy: RequestPolicy,
  parse: (response: Response) => Promise<T>,
  fetchImpl: FetchLike = fetch,
): Promise<RequestResult<T>> {
  const host = hostOf(url);
  const started = Date.now();
  const maxAttempts = 1 + Math.max(0, Math.min(policy.retries, 5));
  let lastError: ProviderError | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (policy.signal?.aborted) {
      throw new ProviderError("cancelled", "Request cancelled before it started", host, attempt - 1);
    }
    const timeoutSignal = AbortSignal.timeout(policy.timeoutMs);
    const signal = policy.signal ? AbortSignal.any([timeoutSignal, policy.signal]) : timeoutSignal;
    let waitMs = (policy.backoffMs ?? 750) * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);

    try {
      const response = await fetchImpl(url, { ...init, signal });
      if (!response.ok) {
        const kind = classifyStatus(response.status);
        // Drain a small part of the body for diagnostics, without secrets.
        const detail = (await response.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
        lastError = new ProviderError(kind, `HTTP ${response.status} from ${host}${detail ? `: ${detail}` : ""}`, host, attempt, response.status);
        waitMs = retryAfterMs(response) ?? waitMs;
      } else {
        const value = await parse(response);
        return { value, status: response.status, attempts: attempt, durationMs: Date.now() - started };
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        lastError = error;
      } else if (policy.signal?.aborted) {
        throw new ProviderError("cancelled", "Request cancelled", host, attempt);
      } else if (timeoutSignal.aborted) {
        lastError = new ProviderError("timeout", `No complete response from ${host} within ${policy.timeoutMs} ms`, host, attempt);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        lastError = new ProviderError("network", `Network error contacting ${host}: ${message}`, host, attempt);
      }
    }

    if (!lastError.retryable || attempt === maxAttempts) break;
    try {
      await sleep(waitMs, policy.signal);
    } catch {
      throw new ProviderError("cancelled", "Request cancelled during backoff", host, attempt);
    }
  }

  const final = lastError ?? new ProviderError("network", `Request to ${host} failed`, host, maxAttempts);
  throw new ProviderError(final.kind, final.message, final.host, final.attempts, final.status);
}

export const parseJson = <T>(response: Response): Promise<T> => response.json() as Promise<T>;
export const parseBytes = async (response: Response): Promise<Uint8Array> => new Uint8Array(await response.arrayBuffer());
export const parseText = (response: Response): Promise<string> => response.text();
