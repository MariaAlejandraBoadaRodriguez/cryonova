/**
 * Ops helper: clears the cached interpretation of a run so the next
 * GET /api/runs/{id}/explanation regenerates it (e.g. after a prompt fix).
 *
 *   npx tsx scripts/clear-explanation.ts <run-id>
 */
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) throw new Error("Usage: clear-explanation.ts <run-id>");
  const { NeonRunStore } = await import("@/src/db/store");
  const store = new NeonRunStore();
  if (!(await store.getRun(id))) throw new Error("Run not found");
  await store.setExplanation(id, null);
  console.log(`cleared explanation for ${id}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
