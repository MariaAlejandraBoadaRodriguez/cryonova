/**
 * Ops helper: compact summary of a run from the database (status, timings,
 * per-variable trends with BH q-values, exclusions, explanation checks).
 *
 *   npx tsx scripts/run-summary.ts <run-id>
 */
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: run-summary.ts <run-id>");
  const { NeonRunStore } = await import("@/src/db/store");
  const { discover } = await import("@/src/analytics/discovery");
  const run = await new NeonRunStore().getRun(id);
  if (!run) throw new Error("Run not found");
  const out: Record<string, unknown> = { id: run.id, status: run.status, attempts: run.attempts, progress: { ...run.progress, timings: undefined }, error: run.error };
  if (run.result) {
    const r = run.result;
    out.timings = r.timings;
    out.warnings = r.warnings;
    out.sources = r.sources.map((s) => ({ collection: s.collection, read: s.monthsRead, failed: s.monthsFailed, missing: s.monthsMissing, cells: s.window.cells, stride: s.window.stride, readMs: s.readMs, fetched: `${s.fetchedFrom} .. ${s.fetchedTo}` }));
    const d = discover(r);
    out.discovery = { correction: d.correction, rows: d.rows.map((x) => ({ key: x.key, slope: x.slopePerDecade === null ? null : Number(x.slopePerDecade.toFixed(4)), ci95: x.ci95?.map((v) => Number(v.toFixed(4))), units: x.trendUnits, p: x.pValue === null ? null : Number(x.pValue.toFixed(4)), q: x.qValue === null ? null : Number(x.qValue.toFixed(4)), evidence: x.evidence, snr: x.signalToNoise === null ? null : Number(x.signalToNoise.toFixed(2)), n: x.n })), excluded: d.excluded };
  }
  const e = run.explanation as { summaries?: Record<string, { source: string; verification: unknown; ai?: unknown }> } | null;
  if (e?.summaries) out.explanations = Object.fromEntries(Object.entries(e.summaries).map(([lang, x]) => [lang, { source: x.source, verification: x.verification, ai: x.ai }]));
  console.log(JSON.stringify(out, null, 1));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
