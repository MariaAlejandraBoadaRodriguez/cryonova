import { explainRun } from "@/src/agent/explain-service";
import { clientKeyFrom, json, problem } from "@/src/lib/request";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** The run's summary interpretation in a language; computed once, then served from storage. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return problem(404, "Run not found");
  const params = new URL(request.url).searchParams;
  const language = params.get("language") === "es" ? "es" : params.get("language") === "en" ? "en" : undefined;
  const outcome = await explainRun({ runId: id, language, chart: "series", clientKey: clientKeyFrom(request) });
  return outcome.ok ? json(outcome.explanation) : problem(outcome.status, outcome.title);
}
