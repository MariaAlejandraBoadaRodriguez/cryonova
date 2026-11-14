import { z } from "zod";
import { lookupInvestigation } from "@/src/db/investigations";
import { errorMessage, logger } from "@/src/lib/log";
import { clientKeyFrom, json, problem, readJson } from "@/src/lib/request";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().max(40) });

/** Opens a saved investigation by code (code in the body, never in the URL). */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(request));
  } catch {
    return problem(422, "Invalid request", "A code is required.");
  }
  try {
    const outcome = await lookupInvestigation(body.code, clientKeyFrom(request));
    if (outcome.status === "found") {
      logger.info("investigation.opened", { investigationId: outcome.snapshot.investigationId, openCount: outcome.openCount });
      return json({ snapshot: outcome.snapshot });
    }
    if (outcome.status === "throttled") {
      logger.warn("investigation.lookup.throttled", {});
      return problem(429, "Too many attempts", "Too many unsuccessful codes from this browser. Try again later.", { retryAfterSeconds: outcome.retryAfterSeconds });
    }
    return problem(404, "No investigation matches this code", "Check the code and try again.");
  } catch (error) {
    logger.error("investigation.lookup.failed", { error: errorMessage(error) });
    return problem(503, "Lookup unavailable", "Please retry shortly.");
  }
}
