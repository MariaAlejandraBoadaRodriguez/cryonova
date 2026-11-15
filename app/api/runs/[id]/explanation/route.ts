import { explainRun } from "@/src/agent/explain-service";
import { clientKeyFrom, json, problem } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * The run's summary interpretation, in English; computed once, then served from
 * storage. A `language` query parameter from older clients is ignored (D-35).
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return problem(404, "Run not found");
  const outcome = await explainRun({ runId: id, chart: "series", clientKey: clientKeyFrom(request) });
  return outcome.ok ? json(outcome.explanation) : problem(outcome.status, outcome.title);
}
