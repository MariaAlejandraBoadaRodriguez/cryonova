/**
 * Ops helper: checks that the configured Neon database answers over HTTPS.
 * Prints server version, role and database, never the connection string.
 */
import { neon } from "@neondatabase/serverless";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(20_000) } });
  const started = Date.now();
  const rows = await sql`select version() as version, current_user as role, current_database() as db, now() as now`;
  console.log(JSON.stringify({ ok: true, latencyMs: Date.now() - started, ...rows[0] }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
