import { z } from "zod";
import { CHART_KINDS } from "@/src/agent/ask-chart";
import { explainRun } from "@/src/agent/explain-service";
import { clientKeyFrom, json, problem, readJson } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

const Body = z.object({
  runId: z.string().uuid(),
  followUp: z.string().trim().min(2).max(400).optional(),
  chart: z.enum(CHART_KINDS).default("series"),
  language: z.enum(["en", "es"]).optional(),
});

/** Interprets a finished run or answers a follow-up question, from computed facts only. */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(request));
  } catch {
    return problem(422, "Invalid request", "runId, optional followUp (2-400 characters) and chart are expected.");
  }
  const outcome = await explainRun({ ...body, clientKey: clientKeyFrom(request) });
  return outcome.ok ? json(outcome.explanation) : problem(outcome.status, outcome.title);
}
