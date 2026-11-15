/**
 * Explicit deadlines and retry budgets for every provider request.
 * A granule read normally takes ~1.5 s (measured 2026-11-14); the deadline
 * leaves headroom for slow responses without letting a request hang a job.
 */
import type { RequestPolicy } from "@/src/lib/http";

export const POLICIES = {
  cmrSearch: { timeoutMs: 20_000, retries: 2, backoffMs: 750 },
  opendapRead: { timeoutMs: 45_000, retries: 2, backoffMs: 1_000 },
  statusProbe: { timeoutMs: 10_000, retries: 1, backoffMs: 500 },
  anthropic: { timeoutMs: 60_000, retries: 1, backoffMs: 1_500 },
  /** OB.DAAC OPeNDAP rate-limits busy clients (HTTP 429): more retries with longer backoff (2, 4, 8, 16 s; Retry-After honoured up to 10 s) before the bounded full-file fallback. */
  obdaacOpendap: { timeoutMs: 45_000, retries: 4, backoffMs: 2_000 },
  /** Asking a host for a signed download link (no body is read). */
  signedLink: { timeoutMs: 20_000, retries: 2, backoffMs: 1_000 },
  /** Whole-file downloads (OB.DAAC monthly file ~11 MB, CDS results). */
  fileDownload: { timeoutMs: 90_000, retries: 1, backoffMs: 1_500 },
  /** Submitting an asynchronous provider job (CDS, Harmony). */
  jobSubmit: { timeoutMs: 30_000, retries: 1, backoffMs: 1_000 },
  /** One short status check of an asynchronous provider job. */
  jobCheck: { timeoutMs: 15_000, retries: 1, backoffMs: 500 },
  /** NOAA CDO allows 5 requests per second; 429 answers are retried with backoff. */
  noaaCdo: { timeoutMs: 30_000, retries: 3, backoffMs: 1_200 },
} satisfies Record<string, RequestPolicy>;

export function withSignal(policy: RequestPolicy, signal?: AbortSignal): RequestPolicy {
  return signal ? { ...policy, signal } : policy;
}
