/**
 * AI spend and quota guards. Usage is recorded per call (tokens, estimated
 * cost, latency, outcome) and checked before each call against a global daily
 * request cap, a daily budget and a per-client hourly cap.
 */
import { randomUUID } from "node:crypto";
import { and, gte, eq, sql } from "drizzle-orm";
import { getDb, hasDatabase } from "@/src/db/client";
import { aiUsage } from "@/src/db/schema";
import { config } from "@/src/lib/env";
import { errorMessage, logger } from "@/src/lib/log";
import { estimateCostUsd, type TokenUsage } from "./pricing";

export const AI_REQUESTS_PER_HOUR_PER_CLIENT = 20;

interface UsageRecord {
  kind: "plan" | "explain" | "ask";
  model: string;
  usage: TokenUsage;
  ok: boolean;
  latencyMs: number;
  error?: string;
  runId?: string | null;
  clientKey?: string | null;
}

const memory: Array<{ at: number; cost: number; clientKey: string | null }> = [];

export interface QuotaStatus {
  allowed: boolean;
  reason?: string;
  todayRequests: number;
  todayCostUsd: number;
}

export async function checkAiQuota(clientKey: string): Promise<QuotaStatus> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const hourAgo = new Date(Date.now() - 3_600_000);
  let todayRequests = 0;
  let todayCostUsd = 0;
  let clientHour = 0;
  try {
    if (hasDatabase()) {
      const db = getDb();
      const [today] = await db
        .select({ n: sql<number>`count(*)::int`, cost: sql<number>`coalesce(sum(${aiUsage.costUsd}), 0)::float8` })
        .from(aiUsage)
        .where(gte(aiUsage.createdAt, dayStart));
      const [client] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(aiUsage)
        .where(and(eq(aiUsage.clientKey, clientKey), gte(aiUsage.createdAt, hourAgo)));
      todayRequests = today?.n ?? 0;
      todayCostUsd = today?.cost ?? 0;
      clientHour = client?.n ?? 0;
    } else {
      todayRequests = memory.filter((m) => m.at >= dayStart.getTime()).length;
      todayCostUsd = memory.filter((m) => m.at >= dayStart.getTime()).reduce((s, m) => s + m.cost, 0);
      clientHour = memory.filter((m) => m.clientKey === clientKey && m.at >= hourAgo.getTime()).length;
    }
  } catch (error) {
    // Fail closed: without usage data the AI path is not used.
    logger.warn("ai.quota.unavailable", { error: errorMessage(error) });
    return { allowed: false, reason: "AI usage accounting is unavailable", todayRequests, todayCostUsd };
  }
  if (todayRequests >= config.aiDailyRequestLimit) return { allowed: false, reason: "The daily AI request limit was reached", todayRequests, todayCostUsd };
  if (todayCostUsd >= config.aiDailyBudgetUsd) return { allowed: false, reason: "The daily AI budget was reached", todayRequests, todayCostUsd };
  if (clientHour >= AI_REQUESTS_PER_HOUR_PER_CLIENT) return { allowed: false, reason: "Too many AI requests from this browser in the last hour", todayRequests, todayCostUsd };
  return { allowed: true, todayRequests, todayCostUsd };
}

export async function recordAiUsage(record: UsageRecord): Promise<number> {
  const cost = estimateCostUsd(record.model, record.usage);
  logger.info("ai.usage", {
    kind: record.kind,
    model: record.model,
    ok: record.ok,
    latencyMs: record.latencyMs,
    inputTokens: record.usage.inputTokens,
    outputTokens: record.usage.outputTokens,
    cacheReadTokens: record.usage.cacheReadTokens,
    costUsd: Number(cost.toFixed(5)),
    runId: record.runId ?? undefined,
    error: record.error?.slice(0, 160),
  });
  try {
    if (hasDatabase()) {
      await getDb()
        .insert(aiUsage)
        .values({
          id: randomUUID(),
          runId: record.runId ?? null,
          kind: record.kind,
          model: record.model,
          inputTokens: record.usage.inputTokens + record.usage.cacheReadTokens + record.usage.cacheWriteTokens,
          outputTokens: record.usage.outputTokens,
          costUsd: cost,
          ok: record.ok,
          latencyMs: record.latencyMs,
          error: record.error?.slice(0, 400) ?? null,
          clientKey: record.clientKey ?? null,
        });
    } else {
      memory.push({ at: Date.now(), cost, clientKey: record.clientKey ?? null });
    }
  } catch (error) {
    logger.warn("ai.usage.record_failed", { error: errorMessage(error) });
  }
  return cost;
}
