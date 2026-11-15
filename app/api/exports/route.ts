import { z } from "zod";
import type { Explanation } from "@/src/agent/explain";
import { englishSummary, type StoredExplanations } from "@/src/agent/stored-explanations";
import { lookupInvestigation } from "@/src/db/investigations";
import { getRunStore } from "@/src/db/store";
import type { RunResult } from "@/src/jobs/types";
import { formatCode, normalizeCode } from "@/src/lib/codes";
import { errorMessage, logger } from "@/src/lib/log";
import { clientKeyFrom, problem, readJson } from "@/src/lib/request";
import { resultsCsv, seriesCsv } from "@/src/reports/csv";
import { buildPdf } from "@/src/reports/pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  format: z.enum(["csv", "series", "pdf"]),
  runId: z.string().uuid().optional(),
  code: z.string().max(40).optional(),
});

/** Only an English interpretation goes into the PDF (D-35); runs without one export without it. */
function pickExplanation(stored: StoredExplanations | null | undefined): Explanation | null {
  return englishSummary(stored);
}

/** CSV or PDF of a live run (by runId) or a saved investigation (by code in the body). */
export async function POST(request: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await readJson(request));
  } catch {
    return problem(422, "Invalid request", "format and runId or code are required.");
  }
  try {
    let result: RunResult | null = null;
    let explanation: Explanation | null = null;
    let investigationId: string | null = null;
    let code: string | null = null;
    if (body.code) {
      const outcome = await lookupInvestigation(body.code, clientKeyFrom(request));
      if (outcome.status === "throttled") return problem(429, "Too many attempts");
      if (outcome.status !== "found") return problem(404, "No investigation matches this code");
      result = outcome.snapshot.result;
      explanation = pickExplanation(outcome.snapshot.explanation as StoredExplanations | null);
      investigationId = outcome.snapshot.investigationId;
      code = formatCode(normalizeCode(body.code)!);
    } else if (body.runId) {
      const run = await getRunStore().getRun(body.runId);
      if (!run?.result) return problem(404, "Run not found or not finished");
      result = run.result as RunResult;
      explanation = pickExplanation(run.explanation as StoredExplanations | null);
    } else {
      return problem(422, "Invalid request", "runId or code is required.");
    }
    const stamp = result.completedAt.slice(0, 10);
    const base = `cryonova-${(result.region.name ?? "region").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${result.selection.start}-${result.selection.end}-${stamp}`;
    logger.info("export.created", { format: body.format, runId: result.runId, saved: Boolean(investigationId) });
    if (body.format === "pdf") {
      const bytes = await buildPdf(result, { code, investigationId, explanation });
      return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"`, "cache-control": "no-store" } });
    }
    const csv = body.format === "csv" ? resultsCsv(result, { investigationId }) : seriesCsv(result, { investigationId });
    const name = body.format === "csv" ? `${base}-results.csv` : `${base}-series.csv`;
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  } catch (error) {
    logger.error("export.failed", { error: errorMessage(error) });
    return problem(500, "The export could not be generated.");
  }
}
