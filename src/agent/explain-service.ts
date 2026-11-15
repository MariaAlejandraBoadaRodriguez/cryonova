/**
 * Explanation service shared by GET /api/runs/{id}/explanation (cached
 * summary) and POST /api/agent/explain (follow-up questions). Explanations are
 * always written in English (D-35); older non-English summaries stay stored but
 * are never served (see stored-explanations.ts).
 */
import { getRunStore } from "@/src/db/store";
import type { RunResult } from "@/src/jobs/types";
import { config } from "@/src/lib/env";
import { logger } from "@/src/lib/log";
import { describeAgentError } from "./client";
import { type ChartKind, type Explanation, explainWithClaude, explainWithRules } from "./explain";
import { emptyUsage } from "./pricing";
import { englishSummary, type StoredExplanations } from "./stored-explanations";
import { checkAiQuota, recordAiUsage } from "./usage";

export type { StoredExplanations } from "./stored-explanations";

export type ExplainOutcome = { ok: true; explanation: Explanation } | { ok: false; status: number; title: string };

export async function explainRun(input: { runId: string; clientKey: string; chart?: ChartKind; followUp?: string }): Promise<ExplainOutcome> {
  const store = getRunStore();
  const run = await store.getRun(input.runId);
  if (!run) return { ok: false, status: 404, title: "Run not found" };
  const result = run.result as RunResult | null;
  if (!result || (run.status !== "succeeded" && run.status !== "partial")) return { ok: false, status: 409, title: "The run has no results to explain yet." };
  const chart = input.chart ?? "series";
  const stored = (run.explanation ?? {}) as StoredExplanations;
  const cached = englishSummary(stored);
  if (!input.followUp && cached && cached.chart === chart) return { ok: true, explanation: cached };

  // Follow-ups get a rule-based answer about the selected chart; summaries get the rule-based sections.
  const automatic = input.followUp ? "this automatic answer is built from the selected chart's data" : "showing an automatic explanation built from the results";
  const fallback = (status: string, aiError?: string): Explanation => ({
    ...explainWithRules(result, chart, input.followUp),
    followUp: input.followUp ?? null,
    aiStatus: status,
    ...(aiError ? { aiError } : {}),
  });
  let explanation: Explanation;
  if (!config.anthropicKey) {
    explanation = fallback(`AI is not configured on this deployment; ${automatic}.`);
  } else {
    const quota = await checkAiQuota(input.clientKey);
    if (!quota.allowed) {
      explanation = fallback(`${quota.reason}; ${automatic}.`);
    } else {
      const started = Date.now();
      const kind = input.followUp ? "ask" : "explain";
      try {
        explanation = await explainWithClaude(result, { question: run.question, followUp: input.followUp, chart });
        await recordAiUsage({
          kind,
          model: explanation.ai?.model ?? config.anthropicModel,
          usage: { inputTokens: explanation.ai?.inputTokens ?? 0, outputTokens: explanation.ai?.outputTokens ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          ok: true,
          latencyMs: Date.now() - started,
          runId: run.id,
          clientKey: input.clientKey,
        });
        logger.info("agent.explain.ok", { runId: run.id, kind, verified: explanation.verification.verified, unverified: explanation.verification.unverified.length });
      } catch (error) {
        const { reason, message } = describeAgentError(error);
        const usage = (error as { usage?: ReturnType<typeof emptyUsage> }).usage ?? emptyUsage();
        await recordAiUsage({ kind, model: config.anthropicModel, usage, ok: false, latencyMs: Date.now() - started, error: reason, runId: run.id, clientKey: input.clientKey });
        logger.warn("agent.explain.failed", { runId: run.id, kind, chart, reason });
        explanation = fallback(`${message} ${automatic.charAt(0).toUpperCase()}${automatic.slice(1)}.`, message);
      }
    }
  }
  // Legacy keys (summaries by language) are left as stored; the new summary is English.
  const next: StoredExplanations = input.followUp ? { ...stored, followUps: [...(stored.followUps ?? []), explanation].slice(-10) } : { ...stored, summary: explanation };
  await store.setExplanation(run.id, next).catch(() => undefined);
  return { ok: true, explanation };
}
