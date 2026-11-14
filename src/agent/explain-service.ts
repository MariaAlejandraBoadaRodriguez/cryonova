/**
 * Explanation service shared by GET /api/runs/{id}/explanation (cached
 * summary) and POST /api/agent/explain (follow-up questions).
 */
import { getRunStore } from "@/src/db/store";
import type { RunResult } from "@/src/jobs/types";
import { config } from "@/src/lib/env";
import { logger } from "@/src/lib/log";
import { describeAgentError } from "./client";
import { type ChartKind, type Explanation, explainWithClaude, explainWithRules } from "./explain";
import { detectLanguage } from "./language";
import { emptyUsage } from "./pricing";
import type { Language } from "./proposal";
import { checkAiQuota, recordAiUsage } from "./usage";

export interface StoredExplanations {
  summary?: Explanation;
  summaries?: Partial<Record<Language, Explanation>>;
  followUps?: Explanation[];
}

export type ExplainOutcome = { ok: true; explanation: Explanation } | { ok: false; status: number; title: string };

export async function explainRun(input: { runId: string; clientKey: string; language?: Language; chart?: ChartKind; followUp?: string }): Promise<ExplainOutcome> {
  const store = getRunStore();
  const run = await store.getRun(input.runId);
  if (!run) return { ok: false, status: 404, title: "Run not found" };
  const result = run.result as RunResult | null;
  if (!result || (run.status !== "succeeded" && run.status !== "partial")) return { ok: false, status: 409, title: "The run has no results to explain yet." };
  const chart = input.chart ?? "series";
  const language = input.language ?? detectLanguage(`${input.followUp ?? ""} ${run.question ?? ""}`);
  const stored = (run.explanation ?? {}) as StoredExplanations;
  const cached = stored.summaries?.[language] ?? (stored.summary?.language === language ? stored.summary : undefined);
  if (!input.followUp && cached && cached.chart === chart) return { ok: true, explanation: cached };

  const fallback = (status: string): Explanation => ({ ...explainWithRules(result, language, chart), followUp: input.followUp ?? null, aiStatus: status });
  let explanation: Explanation;
  if (!config.anthropicKey) {
    explanation = fallback("AI is not configured on this deployment; showing an automatic explanation built from the results.");
  } else {
    const quota = await checkAiQuota(input.clientKey);
    if (!quota.allowed) {
      explanation = fallback(`${quota.reason}; showing an automatic explanation built from the results.`);
    } else {
      const started = Date.now();
      const kind = input.followUp ? "ask" : "explain";
      try {
        explanation = await explainWithClaude(result, { language, question: run.question, followUp: input.followUp, chart });
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
        explanation = fallback(`${message} Showing an automatic explanation built from the results.`);
      }
    }
  }
  if (input.followUp && explanation.source === "rules" && !explanation.answer) {
    explanation = { ...explanation, sections: null, answer: `${explanation.aiStatus ?? "AI is unavailable."} Free-form questions need the AI assistant; the interpretation above and the tables answer the main points.` };
  }
  const next: StoredExplanations = input.followUp
    ? { ...stored, followUps: [...(stored.followUps ?? []), explanation].slice(-10) }
    : { ...stored, summary: explanation, summaries: { ...(stored.summaries ?? {}), [language]: explanation } };
  await store.setExplanation(run.id, next).catch(() => undefined);
  return { ok: true, explanation };
}
