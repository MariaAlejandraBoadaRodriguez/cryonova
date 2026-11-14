/**
 * Ops smoke helper: enqueues a run directly in the configured database using
 * the same store code as POST /api/runs. Any GET /api/runs/{id} on a
 * deployment then executes it (stalled-run resume), which exercises the real
 * provider path from that deployment. Prints the run id only.
 *
 *   npx tsx scripts/enqueue-run.ts [--start 2005-01] [--end 2024-12] [--vars merra2.T2M] [--name Colombia] [--region country:CO]
 */
import { randomUUID } from "node:crypto";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function main(): Promise<void> {
  const { NeonRunStore } = await import("@/src/db/store");
  const { SelectionSchema } = await import("@/src/jobs/selection");
  const { getRegion } = await import("@/src/catalog/regions");
  const region = getRegion(arg("region", "country:CO"));
  if (!region) throw new Error("Unknown region id");
  const selection = SelectionSchema.parse({
    question: arg("question", "Did near-surface air temperature in Colombia change between 2005 and 2024?"),
    region: { bbox: region.bbox, name: region.names.en, regionId: region.id, source: "named" },
    start: arg("start", "2005-01"),
    end: arg("end", "2024-12"),
    variables: arg("vars", "merra2.T2M").split(","),
    mode: "manual",
  });
  const { run } = await new NeonRunStore().createRun({ id: randomUUID(), selection, idempotencyKey: `smoke-${randomUUID()}`, clientKey: "ops-smoke" });
  console.log(run.id);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
