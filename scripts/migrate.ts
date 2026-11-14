/**
 * Applies SQL migrations from db/migrations with Drizzle's Neon HTTP migrator.
 *
 * Usage:
 *   npm run db:migrate                         # target from DATABASE_URL_UNPOOLED or DATABASE_URL
 *   npm run db:migrate -- --database NAME      # same server, another database (e.g. cryonova_test)
 *   npm run db:migrate -- --create-database    # create the target database first if missing
 * Prints the applied migration list, never the connection string.
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set");
  const dbIndex = args.indexOf("--database");
  const database = dbIndex >= 0 ? args[dbIndex + 1] : undefined;
  if (database !== undefined && !/^[a-z_][a-z0-9_]{0,62}$/.test(database)) throw new Error("Invalid database name");
  const target = database ? withDatabase(base, database) : base;
  const fetchOptions = { signal: AbortSignal.timeout(60_000) };

  if (database && args.includes("--create-database")) {
    const admin = neon(base, { fetchOptions });
    const exists = await admin`select 1 from pg_database where datname = ${database}`;
    if (exists.length === 0) {
      await admin.query(`create database ${database}`);
      console.log(`created database ${database}`);
    }
  }

  const sql = neon(target, { fetchOptions });
  const started = Date.now();
  await migrate(drizzle(sql), { migrationsFolder: "db/migrations" });
  const applied = await sql`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at`;
  const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`;
  console.log(
    JSON.stringify(
      {
        ok: true,
        database: new URL(target).pathname.slice(1),
        durationMs: Date.now() - started,
        migrations: applied.map((m) => ({ id: m.id, hash: String(m.hash).slice(0, 12), appliedAt: m.created_at })),
        tables: tables.map((t) => t.table_name),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
