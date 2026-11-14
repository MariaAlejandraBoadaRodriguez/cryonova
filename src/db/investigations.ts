/**
 * Saved investigations: immutable snapshots of a run retrievable by a random
 * code. Only the code hash is stored. Failed lookups are throttled per client
 * to make enumeration impractical; the response never reveals whether a code
 * exists beyond "found" or "not found".
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Explanation } from "@/src/agent/explain";
import type { RunResult } from "@/src/jobs/types";
import { generateRetrievalCode, hashCode, normalizeCode } from "@/src/lib/codes";
import { config } from "@/src/lib/env";
import { getDb, hasDatabase } from "./client";
import { codeAttempts, investigations } from "./schema";

export const SNAPSHOT_VERSION = 1;

export interface InvestigationSnapshot {
  schemaVersion: number;
  investigationId: string;
  runId: string;
  savedAt: string;
  question: string | null;
  result: RunResult;
  explanation: { summary?: Explanation; summaries?: Record<string, Explanation>; followUps?: Explanation[] } | null;
}

export interface SavedInvestigation {
  investigationId: string;
  code: string;
  snapshot: InvestigationSnapshot;
}

export type LookupOutcome = { status: "found"; snapshot: InvestigationSnapshot; openCount: number } | { status: "not_found" } | { status: "throttled"; retryAfterSeconds: number } | { status: "invalid" };

const memorySaved = new Map<string, { snapshot: InvestigationSnapshot; openCount: number }>();
const memoryAttempts = new Map<string, number>();

function windowStart(now = new Date()): Date {
  const ms = 10 * 60 * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

export async function saveInvestigation(input: { runId: string; question: string | null; result: RunResult; explanation: InvestigationSnapshot["explanation"] }): Promise<SavedInvestigation> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generateRetrievalCode();
    const codeHash = hashCode(normalizeCode(code)!);
    const investigationId = randomUUID();
    const snapshot: InvestigationSnapshot = {
      schemaVersion: SNAPSHOT_VERSION,
      investigationId,
      runId: input.runId,
      savedAt: new Date().toISOString(),
      question: input.question,
      result: input.result,
      explanation: input.explanation,
    };
    if (!hasDatabase()) {
      if (memorySaved.has(codeHash)) continue;
      memorySaved.set(codeHash, { snapshot, openCount: 0 });
      return { investigationId, code, snapshot };
    }
    const inserted = await getDb()
      .insert(investigations)
      .values({ id: investigationId, codeHash, runId: input.runId, question: input.question, snapshot, schemaVersion: SNAPSHOT_VERSION })
      .onConflictDoNothing({ target: investigations.codeHash })
      .returning({ id: investigations.id });
    if (inserted.length === 1) return { investigationId, code, snapshot };
  }
  throw new Error("Could not allocate a unique retrieval code");
}

async function failuresInWindow(clientKey: string, start: Date): Promise<number> {
  if (!hasDatabase()) return memoryAttempts.get(`${clientKey}|${start.getTime()}`) ?? 0;
  const rows = await getDb()
    .select({ failures: codeAttempts.failures })
    .from(codeAttempts)
    .where(and(eq(codeAttempts.clientKey, clientKey), eq(codeAttempts.windowStart, start)));
  return rows[0]?.failures ?? 0;
}

async function recordFailure(clientKey: string, start: Date): Promise<void> {
  if (!hasDatabase()) {
    const key = `${clientKey}|${start.getTime()}`;
    memoryAttempts.set(key, (memoryAttempts.get(key) ?? 0) + 1);
    return;
  }
  await getDb()
    .insert(codeAttempts)
    .values({ clientKey, windowStart: start, failures: 1 })
    .onConflictDoUpdate({ target: [codeAttempts.clientKey, codeAttempts.windowStart], set: { failures: sql`${codeAttempts.failures} + 1` } });
}

export async function lookupInvestigation(rawCode: string, clientKey: string): Promise<LookupOutcome> {
  const start = windowStart();
  if ((await failuresInWindow(clientKey, start)) >= config.codeLookupFailuresPer10Min) {
    return { status: "throttled", retryAfterSeconds: Math.ceil((start.getTime() + 600_000 - Date.now()) / 1000) };
  }
  const normalized = normalizeCode(rawCode);
  if (!normalized) {
    await recordFailure(clientKey, start);
    return { status: "invalid" };
  }
  const codeHash = hashCode(normalized);
  if (!hasDatabase()) {
    const found = memorySaved.get(codeHash);
    if (!found) {
      await recordFailure(clientKey, start);
      return { status: "not_found" };
    }
    found.openCount += 1;
    return { status: "found", snapshot: found.snapshot, openCount: found.openCount };
  }
  const rows = await getDb()
    .update(investigations)
    .set({ lastOpenedAt: sql`now()`, openCount: sql`${investigations.openCount} + 1` })
    .where(eq(investigations.codeHash, codeHash))
    .returning({ snapshot: investigations.snapshot, openCount: investigations.openCount });
  if (!rows[0]) {
    await recordFailure(clientKey, start);
    return { status: "not_found" };
  }
  return { status: "found", snapshot: rows[0].snapshot as InvestigationSnapshot, openCount: rows[0].openCount };
}
