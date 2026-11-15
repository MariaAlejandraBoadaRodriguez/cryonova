/**
 * Deterministic, number-exact descriptions of computed results. Used for the
 * results headline, the PDF and as the fallback explanation when the AI
 * provider is unavailable. Every figure comes from the structured result.
 */
import { evidenceLevel, type EvidenceLevel, signalToNoise } from "@/src/analytics/analyze";
import { benjaminiHochberg } from "@/src/analytics/stats";
import type { RunResult, VariableResult } from "@/src/jobs/types";
import { decimalsFor, fmt, fmtP, fmtSigned } from "@/src/lib/format";

const decimalsOf = (v: VariableResult) => decimalsFor(v.unitGroup);

/**
 * Short evidence names shown on badges, in the comparison table, the CSV and
 * the PDF. A "no clear trend yet" result is valid evidence and is always
 * shown and explained, never hidden.
 */
export const EVIDENCE_NAME: Record<EvidenceLevel, string> = {
  significant: "Clear trend",
  nominal: "Possible trend, not confirmed",
  inconclusive: "No clear trend yet",
  insufficient: "Not enough data",
};

/**
 * Plain-language meaning of each level ("How to read this"). `corrected` is
 * true when several trends were tested together and the Benjamini–Hochberg
 * correction applies.
 */
export function evidenceMeaning(level: EvidenceLevel, corrected: boolean): string {
  switch (level) {
    case "significant":
      return corrected
        ? "The 95% interval of the trend excludes zero and the trend stays significant after the Benjamini–Hochberg correction for testing several variables at once."
        : "The 95% interval of the trend excludes zero, so the change stands out from natural year-to-year variation in this period.";
    case "nominal":
      return "On its own the 95% interval excludes zero, but the trend is not significant after the Benjamini–Hochberg correction for testing several variables at once, so it may be a chance result. Treat it as a lead to check, not a finding.";
    case "inconclusive":
      return "The 95% interval of the trend includes zero: the data cannot separate the change from natural year-to-year variation in this period. A longer period or a different region may help.";
    default:
      return "Too few complete years (each with 12 valid months) to estimate a trend; at least 10 are needed.";
  }
}

/** Name and meaning in one sentence, for text-only outputs (AI facts, PDF findings). */
export const EVIDENCE_LABEL: Record<EvidenceLevel, string> = {
  significant: "Clear trend: the 95% interval excludes zero (and, when several trends are compared, the trend stays significant after the Benjamini–Hochberg correction)",
  nominal: "Possible trend, not confirmed: the 95% interval excludes zero, but the trend is not significant after the Benjamini–Hochberg correction for comparing several trends",
  inconclusive: "No clear trend yet: the 95% interval includes zero, so the data cannot separate the change from natural year-to-year variation in this period",
  insufficient: "Not enough data: too few complete years to estimate a trend",
};

/** One-line note shown under the comparison table and in the reports. */
export const NO_CLEAR_TREND_NOTE =
  "No clear trend yet means the data cannot separate the change from natural year-to-year variation in this period; a longer period or a different region may help.";

export function regionLabel(result: Pick<RunResult, "region">): string {
  return result.region.name ?? "the selected region";
}

export function trendSentence(v: VariableResult, region: string): string {
  const a = v.analysis;
  const d = decimalsOf(v);
  if (a.trend.status !== "ok") {
    return `${v.name.en} in ${region}: ${a.trend.reason}`;
  }
  const t = a.trend;
  const excludesZero = t.ci95PerDecade[0] > 0 || t.ci95PerDecade[1] < 0;
  const ci = `95% CI ${fmtSigned(t.ci95PerDecade[0], d)} to ${fmtSigned(t.ci95PerDecade[1], d)}`;
  if (!excludesZero) {
    return `${v.name.en} in ${region} shows no clear trend from ${t.firstYear} to ${t.lastYear}: the estimate is ${fmtSigned(t.slopePerDecade, d)} ${a.trendUnits}, but the ${ci} includes zero (p ${pText(t.pValue)}, ${t.n} complete years).`;
  }
  const verb = t.slopePerDecade > 0 ? "increased" : "decreased";
  return `${v.name.en} in ${region} ${verb} by ${fmt(Math.abs(t.slopePerDecade), d)} ${a.trendUnits} from ${t.firstYear} to ${t.lastYear} (${ci}; p ${pText(t.pValue)}; ${t.n} complete years), a fitted change of ${fmtSigned(t.totalChange, d)} ${a.units} over the period.`;
}

export function pText(p: number): string {
  const text = fmtP(p);
  return text.startsWith("<") ? text : `= ${text}`;
}

export function coverageSentence(v: VariableResult): string {
  const c = v.analysis.coverage;
  const parts = [`${c.monthsValid} of ${c.requestedMonths} months have valid data`];
  if (c.failedMonths.length > 0) parts.push(`${c.failedMonths.length} reads failed`);
  if (c.monthsWithGranule < c.requestedMonths) parts.push(`${c.requestedMonths - c.monthsWithGranule} months are not published`);
  if (c.meanValidCellFraction !== null && c.meanValidCellFraction < 0.999) parts.push(`on average ${fmt(c.meanValidCellFraction * 100, 1)}% of grid cells were valid`);
  if (c.stride > 1) parts.push(`the region was sampled every ${c.stride} cells`);
  return `${parts.join("; ")}.`;
}

export function magnitudeSentence(v: VariableResult): string | null {
  const snr = signalToNoise(v.analysis.trend);
  if (snr === null || v.analysis.trend.status !== "ok") return null;
  const t = v.analysis.trend;
  return `The fitted change (${fmtSigned(t.totalChange, decimalsOf(v))} ${v.analysis.units}) is ${fmt(snr, 1)} times the typical year-to-year variation (${fmt(t.residualSd, decimalsOf(v))} ${v.analysis.units}).`;
}

/** Plain-language summary of a whole run, safe to show when AI is unavailable. */
export function deterministicSummary(result: RunResult): string[] {
  const region = regionLabel(result);
  const lines: string[] = [];
  for (const v of result.variables) {
    lines.push(trendSentence(v, region));
    const magnitude = magnitudeSentence(v);
    if (magnitude) lines.push(magnitude);
    lines.push(coverageSentence(v));
  }
  const sources = result.sources.map((s) => s.label ?? `${s.collection} v${s.version}`).join(", ");
  const served = [...new Set(result.sources.map((s) => s.servedBy ?? "NASA Earthdata"))].join(", ");
  lines.push(`Values were read live from ${served} (${sources}) between ${result.sources[0]?.fetchedFrom?.slice(0, 16).replace("T", " ") ?? "—"} and ${result.sources[0]?.fetchedTo?.slice(0, 16).replace("T", " ") ?? "—"} UTC.`);
  return lines;
}

export function evidenceOf(v: VariableResult, qValue: number | null = null): EvidenceLevel {
  return evidenceLevel(v.analysis.trend, qValue);
}

/** Benjamini–Hochberg q-values per variable when a run tests more than one trend (else empty). */
export function qValuesFor(result: Pick<RunResult, "variables">): Map<string, number> {
  const tested = result.variables.filter((v) => v.analysis.trend.status === "ok");
  if (tested.length < 2) return new Map();
  const q = benjaminiHochberg(tested.map((v) => (v.analysis.trend.status === "ok" ? v.analysis.trend.pValue : 1)));
  return new Map(tested.map((v, i) => [v.key, q[i] as number]));
}
