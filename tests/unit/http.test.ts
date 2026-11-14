import { describe, expect, it, vi } from "vitest";
import { classifyStatus, parseText, ProviderError, requestWithPolicy } from "@/src/lib/http";

const ok = (body = "ok") => new Response(body, { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) => new Response("detail", { status: code, headers });
const fast = { timeoutMs: 200, retries: 2, backoffMs: 1 };

describe("requestWithPolicy", () => {
  it("retries transient 5xx responses and then succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(status(503)).mockResolvedValueOnce(status(502)).mockResolvedValueOnce(ok("done"));
    const result = await requestWithPolicy("https://example.test/a", {}, fast, parseText, fetchImpl);
    expect(result.value).toBe("done");
    expect(result.attempts).toBe(3);
  });

  it.each([
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [400, "bad_request"],
  ])("does not retry HTTP %i (%s)", async (code, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue(status(code));
    await expect(requestWithPolicy("https://example.test/b", {}, fast, parseText, fetchImpl)).rejects.toMatchObject({ kind, attempts: 1, status: code });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies 429 as rate limited and honours the retry budget", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(status(429, { "retry-after": "0" }));
    await expect(requestWithPolicy("https://example.test/c", {}, fast, parseText, fetchImpl)).rejects.toMatchObject({ kind: "rate_limited", attempts: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("turns a request that never answers into a timeout after the retry budget", async () => {
    const hang = (_: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    const started = Date.now();
    await expect(requestWithPolicy("https://slow.test/d", {}, { timeoutMs: 50, retries: 1, backoffMs: 1 }, parseText, hang)).rejects.toMatchObject({
      kind: "timeout",
      host: "slow.test",
      attempts: 2,
    });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("applies the deadline to slow bodies too", async () => {
    const slowBody = (_: string, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: () => new Promise<string>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      } as unknown as Response);
    await expect(requestWithPolicy("https://slow.test/e", {}, { timeoutMs: 40, retries: 0 }, parseText, slowBody)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("reports network errors and caller cancellation distinctly", async () => {
    const broken = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(requestWithPolicy("https://down.test/f", {}, { ...fast, retries: 0 }, parseText, broken)).rejects.toMatchObject({ kind: "network" });
    const controller = new AbortController();
    controller.abort();
    await expect(requestWithPolicy("https://x.test/g", {}, { ...fast, signal: controller.signal }, parseText, broken)).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("exposes retryability and status classification", () => {
    expect(new ProviderError("server", "x", "h", 1).retryable).toBe(true);
    expect(new ProviderError("forbidden", "x", "h", 1).retryable).toBe(false);
    expect(classifyStatus(500)).toBe("server");
    expect(classifyStatus(418)).toBe("bad_request");
  });
});
