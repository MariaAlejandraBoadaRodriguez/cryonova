import { getRunStore } from "@/src/db/store";
import { publicRun } from "@/src/jobs/service";
import { errorMessage, logger } from "@/src/lib/log";
import { json, problem } from "@/src/lib/request";

export const dynamic = "force-dynamic";

/** Requests cancellation; the executor stops at its next checkpoint. */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return problem(404, "Run not found");
  try {
    const run = await getRunStore().requestCancel(id);
    if (!run) return problem(404, "Run not found");
    logger.info("run.cancel.requested", { runId: id, status: run.status });
    return json(publicRun(run));
  } catch (error) {
    logger.error("run.cancel.failed", { runId: id, error: errorMessage(error) });
    return problem(503, "Could not cancel the run", "Please retry shortly.");
  }
}
