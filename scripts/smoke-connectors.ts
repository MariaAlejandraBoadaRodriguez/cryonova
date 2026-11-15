/**
 * Live connector smoke runs through the durable executor, one short invocation
 * per command (no command waits for an asynchronous provider job).
 *
 *   npx tsx scripts/smoke-connectors.ts start <gldas|seawifs|era5|noaa|giovanni-gldas|giovanni-imerg> [--start YYYY-MM --end YYYY-MM]
 *   npx tsx scripts/smoke-connectors.ts resume <runId>     # one more invocation, only if a check is due
 *   npx tsx scripts/smoke-connectors.ts show <runId>       # result summary
 *
 * Runs are stored in a separate database on the same Neon server
 * (--database, default cryonova_dev; create it with
 * `npm run db:migrate -- --database cryonova_dev --create-database`).
 * Prints values and provenance only; never prints credentials.
 */
import { randomUUID } from "node:crypto";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const COLOMBIA = { west: -79, south: -4.25, east: -67, north: 12.5 };
const PRESETS: Record<string, { variables: string[]; bbox: typeof COLOMBIA; name: string; start: string; end: string }> = {
  gldas: { variables: ["gldas.SoilMoi0_10cm_inst", "gldas.RootMoist_inst"], bbox: COLOMBIA, name: "Colombia box", start: "2010-01", end: "2010-12" },
  seawifs: { variables: ["seawifs.chlor_a"], bbox: { west: -81, south: 2, east: -78, north: 7 }, name: "Colombian Pacific", start: "2000-01", end: "2000-03" },
  era5: { variables: ["era5.t2m", "era5.tp"], bbox: COLOMBIA, name: "Colombia box", start: "2010-01", end: "2010-12" },
  noaa: { variables: ["noaa.PRCP", "noaa.TAVG"], bbox: COLOMBIA, name: "Colombia box", start: "2005-01", end: "2014-12" },
  "noaa-colorado": { variables: ["noaa.TAVG", "noaa.PRCP"], bbox: { west: -105.5, south: 39, east: -104.5, north: 40.5 }, name: "Colorado Front Range", start: "2005-01", end: "2014-12" },
  "giovanni-gldas": { variables: ["giovanni.GLDAS_SoilMoi0_10cm"], bbox: COLOMBIA, name: "Colombia box", start: "2010-01", end: "2010-12" },
  "giovanni-imerg": { variables: ["giovanni.IMERG_precipitation"], bbox: COLOMBIA, name: "Colombia box", start: "2010-01", end: "2010-12" },
};

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2);
  const base = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  url.pathname = `/${arg("database", "cryonova_dev")}`;
  process.env.DATABASE_URL = url.toString();
  process.env.NEON_SQL_VIA_ENDPOINT_HOST = "1";
  const { NeonRunStore } = await import("@/src/db/store");
  const { executeRun } = await import("@/src/jobs/runner");
  const { isStalled } = await import("@/src/jobs/service");
  const { SelectionSchema } = await import("@/src/jobs/selection");
  const store = new NeonRunStore();
  let runId = target ?? "";

  if (command === "start") {
    const preset = PRESETS[target ?? ""];
    if (!preset) throw new Error(`Unknown preset; use one of ${Object.keys(PRESETS).join(", ")}`);
    const selection = SelectionSchema.parse({
      question: `Connector smoke run (${target})`,
      region: { bbox: preset.bbox, name: preset.name, source: "coordinates" },
      start: arg("start", preset.start),
      end: arg("end", preset.end),
      variables: preset.variables,
      mode: "manual",
    });
    const { run } = await store.createRun({ id: randomUUID(), selection, idempotencyKey: randomUUID(), clientKey: "smoke-connectors" });
    runId = run.id;
  }
  const before = await store.getRun(runId);
  if (!before) throw new Error("Run not found");
  const started = Date.now();
  let after = before;
  if (command === "start" || (command === "resume" && isStalled(before))) after = (await executeRun(runId, { store, budgetMs: 25_000 })) ?? before;
  else if (command === "resume") console.log(`not due: ${before.progress.waitUntil ?? "lease held"}`);
  const jobs = await store.listJobs(runId);
  const result = after.result;
  console.log(
    JSON.stringify(
      {
        runId,
        status: after.status,
        invocationMs: Date.now() - started,
        message: after.progress.message ?? null,
        waitUntil: after.progress.waitUntil ?? null,
        error: after.error,
        jobs: jobs.map((j) => ({ provider: j.provider, jobRef: j.jobRef, status: j.status, checks: j.checks, submittedAt: j.submittedAt, completedAt: j.completedAt, message: j.message, bytes: j.meta?.bytes ?? null, fetchMs: j.meta?.fetchMs ?? null })),
        warnings: result?.warnings,
        timings: result?.timings,
        sources: result?.sources.map((s) => ({ label: s.label, read: s.monthsRead, failed: s.monthsFailed, missing: s.monthsMissing, bytes: s.bytes, readsVia: s.readsVia, cells: s.window.cells, stride: s.window.stride, readMs: s.readMs, example: s.exampleRequest })),
        variables: result?.variables.map((v) => ({
          key: v.key,
          units: v.analysis.units,
          validMonths: v.analysis.coverage.monthsValid,
          values: v.analysis.monthly.map((p) => [p.month, p.value === null ? null : Number(p.value.toFixed(4)), p.validCells, p.totalCells]),
          stations: v.stations?.slice(0, 6).map((st) => ({ id: st.id, name: st.name, months: st.monthsValid, mean: st.mean === null ? null : Number(st.mean.toFixed(2)), used: st.usedInRegionalMean })),
        })),
      },
      null,
      1,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
