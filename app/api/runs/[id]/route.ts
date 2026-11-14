import { after } from "next/server";
import { getRunStore } from "@/src/db/store";
import { isStalled, publicRun, resume } from "@/src/jobs/service";
import { errorMessage, logger } from "@/src/lib/log";
import { json, problem } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Run status and, once finished, its result. Polling also resumes stalled runs. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return problem(404, "Run not found");
  try {
    const run = await getRunStore().getRun(id);
    if (!run) return problem(404, "Run not found");
    if (isStalled(run)) {
      after(async () => {
        await resume(id).catch((error) => logger.error("run.resume.crash", { runId: id, error: errorMessage(error) }));
      });
    }
    return json(publicRun(run));
  } catch (error) {
    logger.error("run.get.failed", { runId: id, error: errorMessage(error) });
    return problem(503, "Run status unavailable", "Please retry shortly.");
  }
}
