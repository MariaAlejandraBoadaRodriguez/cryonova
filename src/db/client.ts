/**
 * Lazily created Drizzle client over Neon's serverless HTTP driver.
 * Every database request gets a deadline so a stalled query cannot hang a job.
 */
import { neon, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { config } from "@/src/lib/env";
import * as schema from "./schema";

export const DB_QUERY_TIMEOUT_MS = 15_000;

let cached: NeonHttpDatabase<typeof schema> | null = null;
let fetchPatched = false;

function patchFetch(): void {
  if (fetchPatched) return;
  const base = neonConfig.fetchFunction ?? fetch;
  neonConfig.fetchFunction = (input: string, init?: RequestInit) => {
    const deadline = AbortSignal.timeout(DB_QUERY_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return (base as typeof fetch)(input, { ...init, signal });
  };
  fetchPatched = true;
}

export function hasDatabase(): boolean {
  return Boolean(config.databaseUrl);
}

export function getDb(): NeonHttpDatabase<typeof schema> {
  const url = config.databaseUrl;
  if (!url) throw new Error("DATABASE_URL is not configured");
  if (!cached) {
    patchFetch();
    // Opt-in for sandboxes whose egress allowlist only has the endpoint host;
    // that host serves the same SQL-over-HTTP API. Unset on Vercel.
    if (process.env.NEON_SQL_VIA_ENDPOINT_HOST === "1") neonConfig.fetchEndpoint = (host: string) => `https://${host}/sql`;
    cached = drizzle(neon(url), { schema });
  }
  return cached;
}
