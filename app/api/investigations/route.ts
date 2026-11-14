import { z } from "zod";
import { saveInvestigation } from "@/src/db/investigations";
import { getRunStore } from "@/src/db/store";
import type { RunResult } from "@/src/jobs/types";
import { errorMessage, logger } from "@/src/lib/log";
import { json, problem, readJson } from "@/src/lib/request";

export const dynamic = "force-dynamic";

const Body = z.object({ runId: z.string().uuid() });

/** Saves a finished run as a read-only investigation and returns its random code. */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(request));
  } catch {
    return problem(422, "Invalid request", "A runId is required.");
  }
  try {
    const run = await getRunStore().getRun(body.runId);
    if (!run || !run.result || (run.status !== "succeeded" && run.status !== "partial")) return problem(409, "Only finished runs with results can be saved.");
    const saved = await saveInvestigation({ runId: run.id, question: run.question, result: run.result as RunResult, explanation: (run.explanation ?? null) as never });
    logger.info("investigation.saved", { investigationId: saved.investigationId, runId: run.id });
    return json({ code: saved.code, investigationId: saved.investigationId, savedAt: saved.snapshot.savedAt }, { status: 201 });
  } catch (error) {
    logger.error("investigation.save.failed", { runId: body.runId, error: errorMessage(error) });
    return problem(503, "Could not save the investigation", "Please retry shortly.");
  }
}
