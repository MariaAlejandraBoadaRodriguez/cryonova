import { z } from "zod";
import { describeAgentError } from "@/src/agent/client";
import { planWithRules } from "@/src/agent/fallback";
import { planWithClaude } from "@/src/agent/planner";
import { emptyUsage } from "@/src/agent/pricing";
import { finalizeProposal, type Proposal } from "@/src/agent/proposal";
import { checkAiQuota, recordAiUsage } from "@/src/agent/usage";
import { config } from "@/src/lib/env";
import { logger } from "@/src/lib/log";
import { clientKeyFrom, json, problem, readJson } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const Body = z.object({ question: z.string().trim().min(3, "Write a question first.").max(600) });

/** Question -> editable proposal. Falls back to rule-based planning when AI is unavailable. */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(request));
  } catch (error) {
    return problem(422, "Invalid question", error instanceof z.ZodError ? error.issues[0]?.message : "The request body is not valid JSON.");
  }
  const clientKey = clientKeyFrom(request);
  const rules = (status: string): Proposal => ({ ...finalizeProposal(planWithRules(body.question), "rules", body.question), aiStatus: status });

  if (!config.anthropicKey) return json(rules("AI is not configured on this deployment; showing a rule-based proposal."));
  const quota = await checkAiQuota(clientKey);
  if (!quota.allowed) return json(rules(`${quota.reason}; showing a rule-based proposal.`));

  const started = Date.now();
  try {
    const proposal = await planWithClaude(body.question);
    await recordAiUsage({
      kind: "plan",
      model: proposal.ai?.model ?? config.anthropicModel,
      usage: { inputTokens: proposal.ai?.inputTokens ?? 0, outputTokens: proposal.ai?.outputTokens ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      ok: true,
      latencyMs: Date.now() - started,
      clientKey,
    });
    logger.info("agent.plan.ok", { ready: proposal.ready, variables: proposal.selection.variables, tools: proposal.trace.map((t) => t.tool) });
    return json(proposal);
  } catch (error) {
    const { reason, message } = describeAgentError(error);
    const usage = (error as { usage?: ReturnType<typeof emptyUsage> }).usage ?? emptyUsage();
    await recordAiUsage({ kind: "plan", model: config.anthropicModel, usage, ok: false, latencyMs: Date.now() - started, error: reason, clientKey });
    logger.warn("agent.plan.fallback", { reason });
    return json(rules(`${message} Showing a rule-based proposal instead.`));
  }
}
