import { sql } from "drizzle-orm";
import { AGENT_BETAS, agentModel, anthropicClient, describeAgentError } from "@/src/agent/client";
import { addUsage, emptyUsage } from "@/src/agent/pricing";
import { checkAiQuota, recordAiUsage } from "@/src/agent/usage";
import { getDb, hasDatabase } from "@/src/db/client";
import { config, configuredConnectors } from "@/src/lib/env";
import { errorMessage } from "@/src/lib/log";
import { json } from "@/src/lib/request";

export const dynamic = "force-dynamic";

interface AiCheck {
  ok: boolean;
  model: string;
  servedBy?: string;
  latencyMs?: number;
  checkedAt: string;
  error?: string;
}

let cachedAi: { at: number; value: AiCheck } | null = null;

/** One tiny model call proving the deployment's key and model work; cached for 10 minutes. */
async function checkAi(): Promise<AiCheck> {
  if (cachedAi && Date.now() - cachedAi.at < 600_000) return cachedAi.value;
  const model = agentModel();
  const started = Date.now();
  const usage = emptyUsage();
  let value: AiCheck;
  try {
    const quota = await checkAiQuota("health-check");
    if (!quota.allowed) throw new Error(quota.reason);
    const response = await anthropicClient().beta.messages.create(
      { model, max_tokens: 256, betas: AGENT_BETAS, fallbacks: "default", output_config: { effort: "low" }, messages: [{ role: "user", content: "Reply with the single word OK." }] },
      { timeout: 20_000 },
    );
    addUsage(usage, response.usage);
    const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
    value = { ok: text.length > 0 && response.stop_reason !== "refusal", model, servedBy: response.model, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() };
  } catch (error) {
    value = { ok: false, model, latencyMs: Date.now() - started, checkedAt: new Date().toISOString(), error: error instanceof Error && error.message && !("status" in error) ? error.message : describeAgentError(error).message };
  }
  await recordAiUsage({ kind: "health", model, usage, ok: value.ok, latencyMs: value.latencyMs ?? 0, error: value.error, clientKey: "health-check" });
  cachedAi = { at: Date.now(), value };
  return value;
}

/** Liveness and dependency health. Reports configuration, never secret values. ?deep=ai also proves the AI key works. */
export async function GET(request: Request) {
  const started = Date.now();
  const deep = new URL(request.url).searchParams.get("deep");
  let database: { ok: boolean; latencyMs?: number; migration?: number | null; error?: string } = { ok: false, error: "not configured" };
  if (hasDatabase()) {
    try {
      const rows = await getDb().execute(sql`select max(id)::int as migration from drizzle.__drizzle_migrations`);
      database = { ok: true, latencyMs: Date.now() - started, migration: (rows.rows[0] as { migration: number | null } | undefined)?.migration ?? null };
    } catch (error) {
      database = { ok: false, error: errorMessage(error).slice(0, 200) };
    }
  }
  const ai = deep === "ai" ? await checkAi() : undefined;
  const ok = database.ok || !hasDatabase();
  return json(
    {
      ok,
      service: "cryonova",
      environment: config.environment,
      commit: config.commitSha,
      time: new Date().toISOString(),
      database,
      connectorsConfigured: configuredConnectors(),
      model: config.anthropicKey ? config.anthropicModel : null,
      ai,
    },
    { status: ok ? 200 : 503 },
  );
}
