/**
 * Chart and result interpretation. Claude receives only computed facts from
 * the run (values already rounded for display) and must cite numbers exactly;
 * every cited number is verified afterwards. Without AI, a deterministic
 * explanation is built from the same facts.
 */
import { z } from "zod";
import { EVIDENCE_LABEL, evidenceOf, regionLabel } from "@/src/reports/narrative";
import type { RunResult, VariableResult } from "@/src/jobs/types";
import { decimalsFor, fmt, fmtMonth, fmtP, fmtSigned } from "@/src/lib/format";
import { AGENT_BETAS, AI_EFFORT, agentModel, AgentUnavailableError, anthropicClient } from "./client";
import { addUsage, emptyUsage, estimateCostUsd } from "./pricing";
import type { Language } from "./proposal";
import { type Verification, verifyNumbers } from "./verify";

export type ChartKind = "series" | "anomalies" | "seasonal";

export interface ExplanationSections {
  chart: string;
  pattern: string;
  change: string;
  uncertainty: string;
  source: string;
  limitations: string;
}

export interface Explanation {
  source: "ai" | "rules";
  language: Language;
  question: string | null;
  followUp: string | null;
  chart: ChartKind;
  sections: ExplanationSections | null;
  answer: string | null;
  verification: Verification;
  createdAt: string;
  ai?: { model: string; costUsd: number; latencyMs: number; inputTokens: number; outputTokens: number };
  aiStatus?: string;
}

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

function variableFacts(v: VariableResult) {
  const a = v.analysis;
  const d = decimalsFor(v.unitGroup);
  const t = a.trend;
  return {
    key: v.key,
    name: v.name.en,
    name_es: v.name.es,
    product: `${v.product} v${v.version}`,
    units: a.units,
    trendUnits: a.trendUnits,
    trend:
      t.status === "ok"
        ? {
            slopePerDecade: round(t.slopePerDecade, d),
            ci95: [round(t.ci95PerDecade[0], d), round(t.ci95PerDecade[1], d)],
            pValue: t.pValue < 0.001 ? "< 0.001" : round(t.pValue, 3),
            completeYears: t.n,
            firstYear: t.firstYear,
            lastYear: t.lastYear,
            fittedChangeOverPeriod: round(t.totalChange, d),
            typicalYearToYearVariation: round(t.residualSd, d),
          }
        : { status: "insufficient", reason: t.reason },
    evidence: EVIDENCE_LABEL[evidenceOf(v)],
    stats: {
      periodMean: a.stats.mean === null ? null : round(a.stats.mean, d),
      lowestMonth: a.stats.min ? { month: a.stats.min.month, value: round(a.stats.min.value, d) } : null,
      highestMonth: a.stats.max ? { month: a.stats.max.month, value: round(a.stats.max.value, d) } : null,
    },
    coverage: {
      validMonths: a.coverage.monthsValid,
      requestedMonths: a.coverage.requestedMonths,
      failedMonths: a.coverage.failedMonths.length,
      unpublishedMonths: a.coverage.requestedMonths - a.coverage.monthsWithGranule,
      validCellPercent: a.coverage.meanValidCellFraction === null ? null : round(a.coverage.meanValidCellFraction * 100, 1),
      cellsPerMonth: a.coverage.cellsPerMonth,
      samplingStride: a.coverage.stride,
      excludedYears: a.excludedYears.map((e) => e.year),
    },
    seasonalTrends: a.seasonalTrends.map(({ season, trend }) =>
      trend.status === "ok" ? { season, slopePerDecade: round(trend.slopePerDecade, d), ci95: [round(trend.ci95PerDecade[0], d), round(trend.ci95PerDecade[1], d)], pValue: trend.pValue < 0.001 ? "< 0.001" : round(trend.pValue, 3) } : { season, status: "insufficient" },
    ),
    periodComparison: a.periodComparison
      ? { first: a.periodComparison.firstPeriod, second: a.periodComparison.secondPeriod, firstMean: round(a.periodComparison.firstMean, d), secondMean: round(a.periodComparison.secondMean, d), difference: round(a.periodComparison.difference, d), pValue: round(a.periodComparison.pValue, 3) }
      : null,
    highestYears: a.ranking.slice(0, 3).map((r) => ({ year: r.year, mean: round(r.mean, d) })),
    lowestYears: a.ranking.slice(-3).map((r) => ({ year: r.year, mean: round(r.mean, d) })),
    longestPositiveAnomalyRunMonths: a.streaks.longestPositiveAnomalyMonths?.length ?? 0,
  };
}

const CHART_DESCRIPTION: Record<ChartKind, string> = {
  series: "Line chart: thin line = monthly regional mean; dots and line = annual means of complete years; dashed line = OLS linear trend; shaded band = range of trends within the 95% HAC interval. X axis: time; Y axis: the variable in its units.",
  anomalies: "Bar chart of monthly anomalies: each month minus the mean of that calendar month over the selected period; warm bars above zero, blue bars below.",
  seasonal: "Seasonal cycle: mean of each calendar month (January to December) over the selected period.",
};

export function buildFacts(result: RunResult, chart: ChartKind = "series") {
  return {
    region: regionLabel(result),
    bbox: result.region.bbox,
    period: { start: result.selection.start, end: result.selection.end },
    method: result.variables[0]?.analysis.method ?? "",
    regionalMean: "cosine-latitude weighted mean of valid grid cells; years need 12 valid months",
    chart: CHART_DESCRIPTION[chart],
    variables: result.variables.map(variableFacts),
    sources: result.sources.map((s) => ({ product: `${s.collection} v${s.version}`, provider: s.provider, conceptId: s.conceptId, doi: s.doi, fetchedFrom: s.fetchedFrom, fetchedTo: s.fetchedTo, monthsRead: s.monthsRead })),
    warnings: result.warnings,
  };
}

const EXPLAIN_SYSTEM = `You are the research assistant of Cryonova. You explain the results of one live investigation of NASA data to students and teachers.

Rules:
- Use only the FACTS in the user message. Every number you write must appear in FACTS exactly as written there (same decimals, same sign), or be a year or month taken from FACTS. Do not compute, convert or re-round numbers.
- Write in the requested language (en = English, es = Spanish) with plain, precise sentences; 1 to 3 sentences per field.
- chart: what the chart shows (series, axes, units, band). pattern: the pattern observed. change: how much it changed (trend per decade and fitted change over the period). uncertainty: the 95% interval, p-value, number of complete years, coverage and what they mean. source: products, versions and when the data were fetched. limitations: scope limits (regional mean, reanalysis or satellite estimates, gaps, a trend describes this period and does not prove a cause).
- If the trend is insufficient or the interval includes zero, say so clearly instead of claiming a change.
- For a follow-up question, put the reply in "answer" using the same rules; otherwise set "answer" to an empty string.`;

const ExplainSchema = z.object({
  chart: z.string(),
  pattern: z.string(),
  change: z.string(),
  uncertainty: z.string(),
  source: z.string(),
  limitations: z.string(),
  answer: z.string(),
});

const EXPLAIN_JSON_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(["chart", "pattern", "change", "uncertainty", "source", "limitations", "answer"].map((k) => [k, { type: "string" }])),
  required: ["chart", "pattern", "change", "uncertainty", "source", "limitations", "answer"],
  additionalProperties: false,
};

export async function explainWithClaude(result: RunResult, options: { language: Language; question?: string | null; followUp?: string | null; chart?: ChartKind; signal?: AbortSignal }): Promise<Explanation> {
  const client = anthropicClient();
  const model = agentModel();
  const chart = options.chart ?? "series";
  const facts = buildFacts(result, chart);
  const started = Date.now();
  const usage = emptyUsage();
  const payload = { language: options.language, question: options.question ?? null, followUp: options.followUp ?? null, selectedChart: chart, FACTS: facts };
  const response = await client.beta.messages.create(
    {
      model,
      max_tokens: 3000,
      betas: AGENT_BETAS,
      fallbacks: "default",
      output_config: { effort: AI_EFFORT, format: { type: "json_schema", schema: EXPLAIN_JSON_SCHEMA } },
      system: [{ type: "text", text: EXPLAIN_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(payload) }],
    },
    { timeout: 45_000, signal: options.signal ?? AbortSignal.timeout(60_000) },
  );
  addUsage(usage, response.usage);
  if (response.stop_reason === "refusal") throw new AgentUnavailableError("The AI provider declined this request.", "refusal", usage);
  const text = response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  let parsed: z.infer<typeof ExplainSchema>;
  try {
    parsed = ExplainSchema.parse(JSON.parse(text));
  } catch {
    throw new AgentUnavailableError("The AI explanation was not in the expected format.", "bad_output", usage);
  }
  const { answer, ...sections } = parsed;
  const fullText = options.followUp ? answer : Object.values(sections).join(" ");
  return {
    source: "ai",
    language: options.language,
    question: options.question ?? null,
    followUp: options.followUp ?? null,
    chart,
    sections: options.followUp ? null : sections,
    answer: options.followUp ? answer : null,
    verification: verifyNumbers(fullText, facts),
    createdAt: new Date().toISOString(),
    ai: { model: response.model, costUsd: estimateCostUsd(model, usage), latencyMs: Date.now() - started, inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, outputTokens: usage.outputTokens },
  };
}

/** Deterministic explanation from the same facts, in English or Spanish. */
export function explainWithRules(result: RunResult, language: Language, chart: ChartKind = "series"): Explanation {
  const es = language === "es";
  const region = regionLabel(result);
  const parts: ExplanationSections = { chart: "", pattern: "", change: "", uncertainty: "", source: "", limitations: "" };
  const v = result.variables[0];
  const facts = buildFacts(result, chart);
  if (v) {
    const a = v.analysis;
    const d = decimalsFor(v.unitGroup);
    const name = es ? v.name.es : v.name.en;
    parts.chart = es
      ? `El gráfico muestra la media regional mensual (línea fina), las medias anuales de años completos (puntos) y la tendencia lineal con su banda de incertidumbre del 95% para ${name} en ${region}, de ${fmtMonth(result.selection.start)} a ${fmtMonth(result.selection.end)}, en ${a.units}.`
      : `The chart shows the monthly regional mean (thin line), complete-year annual means (dots) and the linear trend with its 95% uncertainty band for ${name} in ${region}, ${fmtMonth(result.selection.start)} to ${fmtMonth(result.selection.end)}, in ${a.units}.`;
    if (a.trend.status === "ok") {
      const t = a.trend;
      const clear = t.ci95PerDecade[0] > 0 || t.ci95PerDecade[1] < 0;
      const up = t.slopePerDecade > 0;
      parts.pattern = es
        ? clear
          ? `Entre ${t.firstYear} y ${t.lastYear} la variable ${up ? "aumentó" : "disminuyó"} de forma sostenida.`
          : `Entre ${t.firstYear} y ${t.lastYear} no hay una tendencia clara: el intervalo del 95% incluye el cero.`
        : clear
          ? `From ${t.firstYear} to ${t.lastYear} the variable ${up ? "increased" : "decreased"} steadily.`
          : `From ${t.firstYear} to ${t.lastYear} there is no clear trend: the 95% interval includes zero.`;
      parts.change = es
        ? `La tendencia es de ${fmtSigned(t.slopePerDecade, d)} ${a.trendUnits}, un cambio ajustado de ${fmtSigned(t.totalChange, d)} ${a.units} en el periodo.`
        : `The trend is ${fmtSigned(t.slopePerDecade, d)} ${a.trendUnits}, a fitted change of ${fmtSigned(t.totalChange, d)} ${a.units} over the period.`;
      parts.uncertainty = es
        ? `Intervalo del 95% (HAC): ${fmtSigned(t.ci95PerDecade[0], d)} a ${fmtSigned(t.ci95PerDecade[1], d)}; p ${fmtP(t.pValue)}; ${t.n} años completos; ${a.coverage.monthsValid} de ${a.coverage.requestedMonths} meses con datos válidos.`
        : `95% interval (HAC): ${fmtSigned(t.ci95PerDecade[0], d)} to ${fmtSigned(t.ci95PerDecade[1], d)}; p ${fmtP(t.pValue)}; ${t.n} complete years; ${a.coverage.monthsValid} of ${a.coverage.requestedMonths} months with valid data.`;
    } else {
      parts.pattern = es ? "No hay suficientes años completos para estimar una tendencia." : a.trend.reason;
      parts.change = es ? `Media del periodo: ${fmt(a.stats.mean, d)} ${a.units}.` : `Period mean: ${fmt(a.stats.mean, d)} ${a.units}.`;
      parts.uncertainty = es ? `${a.coverage.monthsValid} de ${a.coverage.requestedMonths} meses con datos válidos.` : `${a.coverage.monthsValid} of ${a.coverage.requestedMonths} months have valid data.`;
    }
    const s = result.sources[0];
    parts.source = es
      ? `Datos leídos en vivo de NASA (${result.sources.map((x) => `${x.collection} v${x.version}`).join(", ")}) entre ${s?.fetchedFrom?.slice(0, 16).replace("T", " ") ?? "—"} y ${s?.fetchedTo?.slice(0, 16).replace("T", " ") ?? "—"} UTC.`
      : `Data read live from NASA (${result.sources.map((x) => `${x.collection} v${x.version}`).join(", ")}) between ${s?.fetchedFrom?.slice(0, 16).replace("T", " ") ?? "—"} and ${s?.fetchedTo?.slice(0, 16).replace("T", " ") ?? "—"} UTC.`;
    parts.limitations = es
      ? "Es un promedio regional que oculta diferencias locales; MERRA-2 es un reanálisis (modelo más observaciones); una tendencia describe este periodo y no demuestra una causa."
      : "This is a regional average that hides local differences; MERRA-2 is a reanalysis (model plus observations); a trend describes this period and does not establish a cause.";
  }
  return {
    source: "rules",
    language,
    question: result.selection.question ?? null,
    followUp: null,
    chart,
    sections: parts,
    answer: null,
    verification: verifyNumbers(Object.values(parts).join(" "), facts),
    createdAt: new Date().toISOString(),
  };
}
