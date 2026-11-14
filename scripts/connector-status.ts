/** Ops helper: prints each connector's live status (same probes as /api/connectors/status). */
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

async function main(): Promise<void> {
  const { connectorStatus } = await import("@/src/providers/status");
  for (const c of await connectorStatus()) {
    console.log(`${c.id.padEnd(9)} ${c.state.padEnd(14)} ${(c.latestData ?? "-").padEnd(8)} ${String(c.latencyMs ?? "-").padStart(5)} ms  ${c.detail}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
