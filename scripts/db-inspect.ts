/**
 * Ops helper: lists non-system schemas, tables and the current role's
 * privileges so migrations never collide with existing objects.
 */
import { neon } from "@neondatabase/serverless";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const sql = neon(url, { fetchOptions: { signal: AbortSignal.timeout(20_000) } });
  const tables = await sql`
    select table_schema, table_name from information_schema.tables
    where table_schema not in ('pg_catalog', 'information_schema') order by 1, 2`;
  const role = await sql`
    select rolname, rolcreatedb, rolcreaterole, rolsuper from pg_roles where rolname = current_user`;
  const databases = await sql`select datname from pg_database where not datistemplate order by 1`;
  console.log(JSON.stringify({ tables, role, databases }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
