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
} satisfies Record<string, RequestPolicy>;

export function withSignal(policy: RequestPolicy, signal?: AbortSignal): RequestPolicy {
  return signal ? { ...policy, signal } : policy;
}
