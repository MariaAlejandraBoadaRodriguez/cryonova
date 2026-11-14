import { json } from "@/src/lib/request";
import { connectorStatus } from "@/src/providers/status";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Each connector's real status, probed live where a connector exists. */
export async function GET() {
  return json({ connectors: await connectorStatus() });
}
