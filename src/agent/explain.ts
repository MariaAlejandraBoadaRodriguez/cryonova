/**
 * Chart and result interpretation. Claude receives only computed facts from
 * the run (values already rounded for display) and must cite numbers exactly;
 * every cited number is verified afterwards. Without AI, a deterministic
 * explanation is built from the same facts.
 */
import { z } from "zod";
import { TREND_METHOD } from "@/src/analytics/analyze";
import { EVIDENCE_LABEL, evidenceOf, qValuesFor, regionLabel } from "@/src/reports/narrative";
import type { RunResult, VariableResult } from "@/src/jobs/types";
import { decimalsFor, fmt, fmtMonth, fmtP, fmtSigned } from "@/src/lib/format";
import { CHART_LABELS, type ChartKind } from "./ask-chart";
import { AGENT_BETAS, AI_EFFORT, agentModel, AgentUnavailableError, anthropicClient } from "./client";
import { addUsage, emptyUsage, estimateCostUsd } from "./pricing";
import type { Language } from "./proposal";
import { type Verification, verifyNumbers } from "./verify";

export type { ChartKind } from "./ask-chart";

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
  /** Set when the AI provider failed and the rule-based text is shown instead (user-safe message). */
  aiError?: string;
}

const round = (value: number, decimals: number) => Number(value.toFixed(decimals));

function variableFacts(v: VariableResult, qValue: number | null) {
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
    multipleComparisonQValue: qValue === null ? null : qValue < 0.001 ? "< 0.001" : round(qValue, 3),
    evidence: EVIDENCE_LABEL[evidenceOf(v, qValue)],
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

/** Monthly values are listed in full while a run stays this small; longer runs list yearly values and the last months. */
export const MONTHLY_VALUES_BUDGET = 960;
const RECENT_MONTHS = 24;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const CHART_METHOD: Record<ChartKind, (period: string) => string> = {
  series: (period) =>
    `Monthly regional means (thin line) and annual means of complete years (dots; a year needs 12 valid months), ${period}, with the ordinary least squares trend of the annual means (dashed line) and the range of trends inside its 95% interval (shaded band). Trend method: ${TREND_METHOD}.`,
  anomalies: (period) =>
    `Each bar is one month's regional mean minus the mean of the same calendar month over ${period} (the values of the seasonal cycle chart). Bars above zero are months above that calendar month's mean, bars below zero months below it; months without valid data have no bar.`,
  seasonal: (period) =>
    `Mean of each calendar month (January to December) over the valid years of ${period}; "years" is the number of values in each month's mean. The seasonal range is the highest monthly mean minus the lowest.`,
};

type MonthValue = [month: string, value: number];

function seriesData(v: VariableResult, d: number, full: boolean) {
  const a = v.analysis;
  const t = a.trend;
  const valid = a.monthly.filter((p): p is typeof p & { value: number } => p.value !== null).map((p): MonthValue => [p.month, round(p.value, d)]);
  return {
    trendUnits: a.trendUnits,
    annualMeans: a.annual.map((y) => ({ year: y.year, mean: round(y.mean, d) })),
    yearsLeftOut: a.excludedYears.map((e) => ({ year: e.year, validMonths: e.months })),
    trendLine:
      t.status === "ok"
        ? { firstYear: t.firstYear, lastYear: t.lastYear, fittedFirstYear: round(t.fittedStart, d), fittedLastYear: round(t.fittedEnd, d), slopePerDecade: round(t.slopePerDecade, d), ci95PerDecade: [round(t.ci95PerDecade[0], d), round(t.ci95PerDecade[1], d)] }
        : { status: "insufficient", reason: t.reason },
    ...(full ? { monthlyMeans: valid } : { recentMonthlyMeans: valid.slice(-RECENT_MONTHS) }),
  };
}

function anomalyData(v: VariableResult, d: number, full: boolean) {
  const a = v.analysis;
  const valid = a.anomalies.filter((p): p is { month: string; anomaly: number } => p.anomaly !== null);
  let high: (typeof valid)[number] | null = null;
  let low: (typeof valid)[number] | null = null;
  const byYear = new Map<number, number[]>();
  for (const p of valid) {
    if (!high || p.anomaly > high.anomaly) high = p;
    if (!low || p.anomaly < low.anomaly) low = p;
    const year = Number(p.month.slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), p.anomaly]);
  }
  const run = a.streaks.longestPositiveAnomalyMonths;
  const values = valid.map((p): MonthValue => [p.month, round(p.anomaly, d)]);
  return {
    monthsWithAnomaly: valid.length,
    positiveMonths: valid.filter((p) => p.anomaly > 0).length,
    negativeMonths: valid.filter((p) => p.anomaly < 0).length,
    largestPositive: high && high.anomaly > 0 ? { month: high.month, anomaly: round(high.anomaly, d) } : null,
    largestNegative: low && low.anomaly < 0 ? { month: low.month, anomaly: round(low.anomaly, d) } : null,
    longestPositiveRun: run ? { months: run.length, start: run.start, end: run.end } : null,
    currentPositiveRunMonths: a.streaks.currentPositiveAnomalyMonths,
    meanAnomalyByYear: [...byYear].map(([year, list]) => ({ year, meanAnomaly: round(list.reduce((s, x) => s + x, 0) / list.length, d), validMonths: list.length })),
    ...(full ? { monthlyAnomalies: values } : { recentMonthlyAnomalies: values.slice(-RECENT_MONTHS) }),
  };
}

function seasonalData(v: VariableResult, d: number) {
  const months = v.analysis.climatology.filter((c): c is typeof c & { mean: number } => c.mean !== null);
  let high: (typeof months)[number] | null = null;
  let low: (typeof months)[number] | null = null;
  for (const c of months) {
    if (!high || c.mean > high.mean) high = c;
    if (!low || c.mean < low.mean) low = c;
  }
  return {
    calendarMonthMeans: v.analysis.climatology.map((c) => ({ month: MONTH_NAMES[c.month - 1], mean: c.mean === null ? null : round(c.mean, d), years: c.n })),
    highestMonth: high ? { month: MONTH_NAMES[high.month - 1], mean: round(high.mean, d) } : null,
    lowestMonth: low ? { month: MONTH_NAMES[low.month - 1], mean: round(low.mean, d) } : null,
    seasonalRange: high && low ? round(high.mean - low.mean, d) : null,
  };
}

/** The selected chart as plotted on the dashboard: its method and, per variable, the values it shows. */
export function chartFacts(result: RunResult, chart: ChartKind) {
  const period = `${result.selection.start} to ${result.selection.end}`;
  const full = result.variables.reduce((s, v) => s + v.analysis.monthly.length, 0) <= MONTHLY_VALUES_BUDGET;
  return {
    kind: chart,
    title: CHART_LABELS[chart].en,
    method: CHART_METHOD[chart](period),
    listing: chart === "seasonal" || full ? "every plotted value is listed" : `yearly values and the last ${RECENT_MONTHS} months are listed; the dashboard tables hold the rest`,
    variables: result.variables.map((v) => {
      const d = decimalsFor(v.unitGroup);
      const data = chart === "anomalies" ? anomalyData(v, d, full) : chart === "seasonal" ? seasonalData(v, d) : seriesData(v, d, full);
      return { key: v.key, name: v.name.en, units: v.analysis.units, ...data };
    }),
  };
}

export function buildFacts(result: RunResult, chart: ChartKind = "series") {
  const q = qValuesFor(result);
  return {
    multipleComparison: q.size > 0 ? `Benjamini-Hochberg false discovery rate over ${q.size} trends; a trend is significant only if its q-value is below 0.05` : "single trend, no correction",
    region: regionLabel(result),
    bbox: result.region.bbox,
    period: { start: result.selection.start, end: result.selection.end },
    method: result.variables[0]?.analysis.method ?? "",
    regionalMean: "cosine-latitude weighted mean of valid grid cells; years need 12 valid months",
    chart: CHART_DESCRIPTION[chart],
    selectedChart: chartFacts(result, chart),
    variables: result.variables.map((v) => variableFacts(v, q.get(v.key) ?? null)),
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
- When several trends were tested (multipleComparison in FACTS), call a trend statistically significant only when its "evidence" says so after the Benjamini-Hochberg correction; a p-value below 0.05 with a q-value at or above 0.05 is only nominal and must be described that way.
- FACTS.selectedChart is the chart the user selected: its method and, for each variable, the values it plots.
- For a follow-up question, answer it about the selected chart in "answer" (2 to 5 sentences), using FACTS.selectedChart first and the other FACTS where they help, with the same rules. Never leave "answer" empty: if FACTS cannot answer part of the question, say which figure is not available and describe what the selected chart shows. For a follow-up, set the other six fields to empty strings.
- Without a follow-up question, set "answer" to an empty string.`;

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
  if (options.followUp && answer.trim() === "") throw new AgentUnavailableError("The AI assistant returned an empty answer.", "empty_answer", usage);
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const monthText = (ym: string) => `${MONTH_NAMES[Number(ym.slice(5, 7)) - 1] ?? ym.slice(5, 7)} ${ym.slice(0, 4)}`;

type ChartVariable<K extends ChartKind> = ReturnType<typeof chartFacts>["variables"][number] &
  (K extends "anomalies" ? ReturnType<typeof anomalyData> : K extends "seasonal" ? ReturnType<typeof seasonalData> : ReturnType<typeof seriesData>);

function seriesAnswer(v: VariableResult, region: string, period: string): string {
  const a = v.analysis;
  const d = decimalsFor(v.unitGroup);
  const intro = `The series and trend chart shows ${v.name.en} in ${region}, ${period}, in ${a.units}: the thin line is the monthly regional mean, the dots are the annual means of complete years and the dashed line is the linear trend with its 95% band.`;
  const t = a.trend;
  if (t.status !== "ok") return `${intro} ${t.reason} The period mean is ${fmt(a.stats.mean, d)} ${a.units}.`;
  const clear = t.ci95PerDecade[0] > 0 || t.ci95PerDecade[1] < 0;
  const trend = `The trend is ${fmtSigned(t.slopePerDecade, d)} ${a.trendUnits} (95% interval ${fmtSigned(t.ci95PerDecade[0], d)} to ${fmtSigned(t.ci95PerDecade[1], d)}; p ${fmtP(t.pValue)}; ${t.n} complete years), a fitted change of ${fmtSigned(t.totalChange, d)} ${a.units} from ${t.firstYear} to ${t.lastYear}${clear ? "." : "; the interval includes zero, so the chart shows no clear trend."}`;
  const top = a.ranking[0];
  const bottom = a.ranking[a.ranking.length - 1];
  const years = top && bottom && top.year !== bottom.year ? ` The highest annual mean was ${fmt(top.mean, d)} ${a.units} in ${top.year} and the lowest ${fmt(bottom.mean, d)} ${a.units} in ${bottom.year}.` : "";
  return `${intro} ${trend}${years}`;
}

function anomaliesAnswer(v: VariableResult, c: ChartVariable<"anomalies">, region: string, period: string): string {
  const d = decimalsFor(v.unitGroup);
  const u = c.units;
  const intro = `The monthly anomalies chart shows how far each month of ${v.name.en} in ${region} was from the mean of the same calendar month over ${period}, in ${u}.`;
  if (c.monthsWithAnomaly === 0) return `${intro} No month has valid data, so the chart has no bars.`;
  const parts = [intro, `${c.positiveMonths} of ${c.monthsWithAnomaly} months were above their calendar-month mean and ${c.negativeMonths} below it.`];
  const extremes = [
    c.largestPositive && `The largest positive anomaly was ${fmtSigned(c.largestPositive.anomaly, d)} ${u} in ${monthText(c.largestPositive.month)}`,
    c.largestNegative && `the largest negative anomaly was ${fmtSigned(c.largestNegative.anomaly, d)} ${u} in ${monthText(c.largestNegative.month)}`,
  ].filter(Boolean);
  if (extremes.length > 0) parts.push(`${extremes.join("; ")}.`.replace(/^the/, "The"));
  if (c.longestPositiveRun) parts.push(`The longest run of positive anomalies lasted ${plural(c.longestPositiveRun.months, "month")} (${monthText(c.longestPositiveRun.start)} to ${monthText(c.longestPositiveRun.end)}).`);
  const complete = c.meanAnomalyByYear.filter((y) => y.validMonths === 12);
  if (complete.length >= 2) {
    const sorted = [...complete].sort((x, y) => y.meanAnomaly - x.meanAnomaly);
    const hi = sorted[0]!;
    const lo = sorted[sorted.length - 1]!;
    parts.push(`Among complete years, the mean anomaly was highest in ${hi.year} (${fmtSigned(hi.meanAnomaly, d)} ${u}) and lowest in ${lo.year} (${fmtSigned(lo.meanAnomaly, d)} ${u}).`);
  }
  return parts.join(" ");
}

function seasonalAnswer(v: VariableResult, c: ChartVariable<"seasonal">, region: string, period: string): string {
  const d = decimalsFor(v.unitGroup);
  const u = c.units;
  const intro = `The seasonal cycle chart shows the mean of each calendar month of ${v.name.en} in ${region} over ${period}, in ${u}.`;
  if (!c.highestMonth || !c.lowestMonth) return `${intro} No calendar month has valid data.`;
  const years = c.calendarMonthMeans.filter((m) => m.mean !== null).map((m) => m.years);
  const fewest = Math.min(...years);
  const most = Math.max(...years);
  return [
    intro,
    `The highest monthly mean is in ${c.highestMonth.month} (${fmt(c.highestMonth.mean, d)} ${u}) and the lowest in ${c.lowestMonth.month} (${fmt(c.lowestMonth.mean, d)} ${u}), a seasonal range of ${fmt(c.seasonalRange, d)} ${u}.`,
    fewest === most ? `Each month's mean uses ${plural(most, "year")} of data.` : `Each month's mean uses between ${fewest} and ${most} years of data.`,
  ].join(" ");
}

/**
 * Rule-based answer about the selected chart, built from the same chart facts
 * the AI receives (English). Covers the first three variables; the dashboard
 * cards show the same chart for the others.
 */
export function chartAnswerWithRules(result: RunResult, chart: ChartKind): string {
  if (result.variables.length === 0) return "This run has no variable results, so the chart is empty.";
  const region = regionLabel(result);
  const period = `${fmtMonth(result.selection.start)} to ${fmtMonth(result.selection.end)}`;
  const facts = chartFacts(result, chart);
  const shown = result.variables.slice(0, 3).map((v, i) => {
    const c = facts.variables[i]!;
    if (chart === "anomalies") return anomaliesAnswer(v, c as ChartVariable<"anomalies">, region, period);
    if (chart === "seasonal") return seasonalAnswer(v, c as ChartVariable<"seasonal">, region, period);
    return seriesAnswer(v, region, period);
  });
  if (result.variables.length > shown.length) shown.push("The same chart for the other variables is in their cards above.");
  return shown.join("\n\n");
}

/**
 * Deterministic explanation from the same facts, in English or Spanish. With a
 * follow-up question it answers about the selected chart instead.
 */
export function explainWithRules(result: RunResult, language: Language, chart: ChartKind = "series", followUp?: string | null): Explanation {
  if (followUp) {
    const answer = chartAnswerWithRules(result, chart);
    return {
      source: "rules",
      language,
      question: result.selection.question ?? null,
      followUp,
      chart,
      sections: null,
      answer,
      verification: verifyNumbers(answer, buildFacts(result, chart)),
      createdAt: new Date().toISOString(),
    };
  }
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
