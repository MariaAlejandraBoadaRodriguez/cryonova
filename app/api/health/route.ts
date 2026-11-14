import { sql } from "drizzle-orm";
import { getDb, hasDatabase } from "@/src/db/client";
import { config, configuredConnectors } from "@/src/lib/env";
import { errorMessage } from "@/src/lib/log";
import { json } from "@/src/lib/request";

export const dynamic = "force-dynamic";

/** Liveness and dependency health. Reports configuration, never secret values. */
export async function GET() {
  const started = Date.now();
  let database: { ok: boolean; latencyMs?: number; migration?: number | null; error?: string } = { ok: false, error: "not configured" };
  if (hasDatabase()) {
    try {
      const rows = await getDb().execute(sql`select max(id)::int as migration from drizzle.__drizzle_migrations`);
      database = { ok: true, latencyMs: Date.now() - started, migration: (rows.rows[0] as { migration: number | null } | undefined)?.migration ?? null };
    } catch (error) {
      database = { ok: false, error: errorMessage(error).slice(0, 200) };
    }
  }
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
    },
    { status: ok ? 200 : 503 },
  );
}
