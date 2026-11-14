import { after } from "next/server";
import { SelectionSchema } from "@/src/jobs/selection";
import { publicRun, resume, startRun } from "@/src/jobs/service";
import { errorMessage, logger } from "@/src/lib/log";
import { clientKeyFrom, json, problem, readJson, validationProblem } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Starts a live run. Repeating the same Idempotency-Key returns the same run. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch (error) {
    return problem(400, "Invalid request body", errorMessage(error));
  }
  const parsed = SelectionSchema.safeParse((body as { selection?: unknown })?.selection ?? body);
  if (!parsed.success) return validationProblem(parsed.error);
  const idempotencyKey = (request.headers.get("idempotency-key") ?? crypto.randomUUID()).slice(0, 80);
  const parentRunId = (body as { parentRunId?: unknown })?.parentRunId;

  try {
    const outcome = await startRun(parsed.data, {
      idempotencyKey,
      clientKey: clientKeyFrom(request),
      parentRunId: typeof parentRunId === "string" && /^[0-9a-f-]{36}$/.test(parentRunId) ? parentRunId : null,
    });
    if ("limited" in outcome) {
      return problem(429, "Too many runs", "This browser started many runs recently. Try again in a few minutes.", { retryAfterSeconds: outcome.retryAfterSeconds });
    }
    if (outcome.created) {
      logger.info("run.created", { runId: outcome.run.id, variables: parsed.data.variables, start: parsed.data.start, end: parsed.data.end, mode: parsed.data.mode });
      after(async () => {
        await resume(outcome.run.id).catch((error) => logger.error("run.execute.crash", { runId: outcome.run.id, error: errorMessage(error) }));
      });
    }
    return json(publicRun(outcome.run), { status: outcome.created ? 202 : 200 });
  } catch (error) {
    logger.error("run.create.failed", { error: errorMessage(error) });
    return problem(503, "Could not start the run", "The run store is unavailable. Please retry shortly.");
  }
}
