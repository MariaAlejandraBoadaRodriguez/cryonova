import { z } from "zod";
import { explainRun } from "@/src/agent/explain-service";
import { clientKeyFrom, json, problem, readJson } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  runId: z.string().uuid(),
  followUp: z.string().trim().min(2).max(400).optional(),
  chart: z.enum(["series", "anomalies", "seasonal"]).default("series"),
  /** Accepted from older clients and ignored: explanations are always in English (D-35). */
  language: z.string().max(16).optional(),
});

/** Interprets a finished run or answers a follow-up question (in English), from computed facts only. */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(request));
  } catch {
    return problem(422, "Invalid request", "runId, optional followUp (2-400 characters) and chart are expected.");
  }
  const outcome = await explainRun({ runId: body.runId, followUp: body.followUp, chart: body.chart, clientKey: clientKeyFrom(request) });
  return outcome.ok ? json(outcome.explanation) : problem(outcome.status, outcome.title);
}
