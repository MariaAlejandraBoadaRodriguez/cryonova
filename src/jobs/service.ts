/**
 * Application service for runs, used by route handlers. Keeps scheduling,
 * rate limiting and the public response shape in one place.
 */
import { randomUUID } from "node:crypto";
import { getRunStore, type RunStore } from "@/src/db/store";
import { config } from "@/src/lib/env";
import { executeRun } from "./runner";
import type { Selection } from "./selection";
import { type RunRow, TERMINAL_STATUSES } from "./types";

export function publicRun(run: RunRow) {
  const terminal = TERMINAL_STATUSES.includes(run.status);
  return {
    id: run.id,
    status: run.status,
    mode: run.mode,
    question: run.question,
    selection: run.selection,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    cancelRequested: run.cancelRequested,
    progress: run.progress,
    error: run.error,
    result: terminal ? run.result : null,
    explanation: terminal ? run.explanation : null,
  };
}

export type PublicRun = ReturnType<typeof publicRun>;

export function isStalled(run: RunRow, now = new Date()): boolean {
  return (run.status === "queued" || run.status === "running") && !run.cancelRequested && (!run.leaseUntil || run.leaseUntil < now);
}

export async function startRun(
  selection: Selection,
  options: { idempotencyKey: string; clientKey: string; parentRunId?: string | null },
  store: RunStore = getRunStore(),
): Promise<{ run: RunRow; created: boolean } | { limited: true; retryAfterSeconds: number }> {
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await store.countRecentRuns(options.clientKey, since);
  if (recent >= config.runsPerHourPerClient) return { limited: true, retryAfterSeconds: 600 };
  return store.createRun({ id: randomUUID(), selection, idempotencyKey: options.idempotencyKey, clientKey: options.clientKey, parentRunId: options.parentRunId ?? null });
}

export function resume(runId: string, store: RunStore = getRunStore()): Promise<RunRow | null> {
  return executeRun(runId, { store });
}
