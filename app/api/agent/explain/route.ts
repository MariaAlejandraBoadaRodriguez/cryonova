import { z } from "zod";
import { describeAgentError } from "@/src/agent/client";
import { type Explanation, explainWithClaude, explainWithRules } from "@/src/agent/explain";
import { detectLanguage } from "@/src/agent/fallback";
import { emptyUsage } from "@/src/agent/pricing";
import { checkAiQuota, recordAiUsage } from "@/src/agent/usage";
import { getRunStore } from "@/src/db/store";
import type { RunResult } from "@/src/jobs/types";
import { config } from "@/src/lib/env";
import { logger } from "@/src/lib/log";
import { clientKeyFrom, json, problem, readJson } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  runId: z.string().uuid(),
  followUp: z.string().trim().min(2).max(400).optional(),
  chart: z.enum(["series", "anomalies", "seasonal"]).default("series"),
  language: z.enum(["en", "es"]).optional(),
});

interface StoredExplanations {
  summary?: Explanation;
  followUps?: Explanation[];
}

/** Interprets a finished run (or answers a follow-up) from its computed facts only. */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(request));
  } catch {
    return problem(422, "Invalid request", "runId, optional followUp (2-400 characters) and chart are expected.");
  }
  const store = getRunStore();
  const run = await store.getRun(body.runId);
  if (!run) return problem(404, "Run not found");
  const result = run.result as RunResult | null;
  if (!result || (run.status !== "succeeded" && run.status !== "partial")) return problem(409, "The run has no results to explain yet.");
  const language = body.language ?? detectLanguage(`${body.followUp ?? ""} ${run.question ?? ""}`);
  const stored = (run.explanation ?? {}) as StoredExplanations;
  if (!body.followUp && stored.summary && stored.summary.language === language && stored.summary.chart === body.chart) return json(stored.summary);

  const clientKey = clientKeyFrom(request);
  const fallback = (status: string): Explanation => ({ ...explainWithRules(result, language, body.chart), followUp: body.followUp ?? null, aiStatus: status });
  let explanation: Explanation;
  if (!config.anthropicKey) {
    explanation = fallback("AI is not configured on this deployment; showing an automatic explanation built from the results.");
  } else {
    const quota = await checkAiQuota(clientKey);
    if (!quota.allowed) {
      explanation = fallback(`${quota.reason}; showing an automatic explanation built from the results.`);
    } else {
      const started = Date.now();
      try {
        explanation = await explainWithClaude(result, { language, question: run.question, followUp: body.followUp, chart: body.chart });
        await recordAiUsage({
          kind: body.followUp ? "ask" : "explain",
          model: explanation.ai?.model ?? config.anthropicModel,
          usage: { inputTokens: explanation.ai?.inputTokens ?? 0, outputTokens: explanation.ai?.outputTokens ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
          ok: true,
          latencyMs: Date.now() - started,
          runId: run.id,
          clientKey,
        });
        logger.info("agent.explain.ok", { runId: run.id, verified: explanation.verification.verified, unverified: explanation.verification.unverified.length });
      } catch (error) {
        const { reason, message } = describeAgentError(error);
        const usage = (error as { usage?: ReturnType<typeof emptyUsage> }).usage ?? emptyUsage();
        await recordAiUsage({ kind: body.followUp ? "ask" : "explain", model: config.anthropicModel, usage, ok: false, latencyMs: Date.now() - started, error: reason, runId: run.id, clientKey });
        explanation = fallback(`${message} Showing an automatic explanation built from the results.`);
        if (body.followUp) explanation = { ...explanation, sections: null, answer: message };
      }
    }
  }
  const next: StoredExplanations = body.followUp
    ? { ...stored, followUps: [...(stored.followUps ?? []), explanation].slice(-10) }
    : { ...stored, summary: explanation };
  await store.setExplanation(run.id, next).catch(() => undefined);
  return json(explanation);
}
