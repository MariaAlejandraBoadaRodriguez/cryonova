/**
 * Live smoke test: runs one real investigation through the durable executor.
 *
 *   npx tsx scripts/smoke-live.ts [--neon] [--start YYYY-MM] [--end YYYY-MM] [--vars a,b] [--bbox w,s,e,n]
 *
 * --neon persists to the database in TEST_DATABASE_URL (or DATABASE_URL).
 * Prints a JSON summary with provenance and timings; never prints secrets.
 */
import { randomUUID } from "node:crypto";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const useNeon = process.argv.includes("--neon");
  if (useNeon && process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  if (!useNeon) delete process.env.DATABASE_URL;
  const { MemoryRunStore, NeonRunStore } = await import("@/src/db/store");
  const { executeRun } = await import("@/src/jobs/runner");
  const { SelectionSchema } = await import("@/src/jobs/selection");

  const [west, south, east, north] = arg("bbox", "-78.99,-4.3,-66.88,12.44").split(",").map(Number) as [number, number, number, number];
  const selection = SelectionSchema.parse({
    question: "Did near-surface air temperature in Colombia change?",
    region: { bbox: { west, south, east, north }, name: arg("name", "Colombia"), source: "named" },
    start: arg("start", "2015-01"),
    end: arg("end", "2016-12"),
    variables: arg("vars", "merra2.T2M").split(","),
    mode: "manual",
  });
  const store = useNeon ? new NeonRunStore() : new MemoryRunStore();
  const { run } = await store.createRun({ id: randomUUID(), selection, idempotencyKey: randomUUID(), clientKey: "smoke" });
  const started = Date.now();
  let final = await executeRun(run.id, { store, budgetMs: Number(arg("budget", "150000")) });
  while (final && (final.status === "queued" || final.status === "running")) final = await executeRun(run.id, { store, budgetMs: 150_000 });
  const result = final?.result;
  console.log(
    JSON.stringify(
      {
        store: useNeon ? "neon" : "memory",
        runId: run.id,
        status: final?.status,
        error: final?.error,
        wallMs: Date.now() - started,
        timings: result?.timings,
        warnings: result?.warnings,
        sources: result?.sources.map((s) => ({ collection: s.collection, conceptId: s.conceptId, read: s.monthsRead, failed: s.monthsFailed, missing: s.monthsMissing, first: s.firstGranule, last: s.lastGranule, readMs: s.readMs, bytes: s.bytes, cells: s.window.cells, fetchedFrom: s.fetchedFrom, fetchedTo: s.fetchedTo })),
        variables: result?.variables.map((v) => ({
          key: v.key,
          units: v.analysis.units,
          validMonths: v.analysis.coverage.monthsValid,
          firstMonths: v.analysis.monthly.slice(0, 3).map((p) => [p.month, p.value === null ? null : Number(p.value.toFixed(4))]),
          trend: v.analysis.trend.status === "ok" ? { perDecade: v.analysis.trend.slopePerDecade, ci95: v.analysis.trend.ci95PerDecade, p: v.analysis.trend.pValue, n: v.analysis.trend.n } : v.analysis.trend,
        })),
      },
      null,
      1,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
