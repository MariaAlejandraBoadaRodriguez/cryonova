/**
 * Short explanatory captions for every chart, generated only from the
 * computed numbers: what the chart shows, the main pattern and how to read
 * it. The dashboard and the PDF print the same text. Inputs are read
 * defensively so results saved by older versions still get a caption.
 */
import type { DiscoveryRow } from "@/src/analytics/discovery";
import type { VariableResult } from "@/src/jobs/types";
import { decimalsFor, fmt, fmtMonth, fmtSigned } from "@/src/lib/format";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const excludesZero = (ci: readonly [number, number]) => ci[0] > 0 || ci[1] < 0;

/** Main chart: monthly and annual means with the linear trend and its 95% band. */
export function seriesCaption(v: VariableResult): string {
  const a = v.analysis;
  const d = decimalsFor(v.unitGroup);
  const what = `Monthly regional mean of ${v.name.en} in ${a.units} (thin line), annual means of complete years (dots) and the fitted linear trend (dashed) with its 95% interval (shaded band).`;
  const t = a.trend;
  if (!t || t.status !== "ok") {
    return `${what} No trend line is drawn: ${t?.reason ?? "there are not enough complete years."}`;
  }
  const range = `${fmtSigned(t.ci95PerDecade[0], d)} to ${fmtSigned(t.ci95PerDecade[1], d)}`;
  const pattern = excludesZero(t.ci95PerDecade)
    ? `From ${t.firstYear} to ${t.lastYear} it ${t.slopePerDecade > 0 ? "rose" : "fell"} by ${fmt(Math.abs(t.slopePerDecade), d)} ${a.trendUnits} (95% interval ${range}): a clear trend.`
    : `From ${t.firstYear} to ${t.lastYear} the estimate is ${fmtSigned(t.slopePerDecade, d)} ${a.trendUnits}, but its 95% interval (${range}) includes zero, so there is no clear trend yet.`;
  return `${what} ${pattern} How to read it: if a flat line fits inside the shaded band, the interval includes zero and the trend is not clear yet.`;
}

/** Monthly anomalies: each month minus the mean of its calendar month. */
export function anomalyCaption(v: VariableResult): string {
  const a = v.analysis;
  const d = decimalsFor(v.unitGroup);
  const what = "Each bar is one month's departure from the average of that calendar month over the selected period (red above zero, blue below).";
  const points = (a.anomalies ?? []).filter((p): p is { month: string; anomaly: number } => typeof p.anomaly === "number" && Number.isFinite(p.anomaly));
  if (points.length === 0) return `${what} No month has a valid value, so no departures could be computed.`;
  const above = points.filter((p) => p.anomaly > 0).length;
  const high = points.reduce((m, p) => (p.anomaly > m.anomaly ? p : m));
  const low = points.reduce((m, p) => (p.anomaly < m.anomaly ? p : m));
  const streak = a.streaks?.longestPositiveAnomalyMonths;
  const run = streak && streak.length > 1 ? ` The longest run above the usual value lasted ${streak.length} months (${fmtMonth(streak.start)} – ${fmtMonth(streak.end)}).` : "";
  const pattern = `${above} of ${points.length} months were above their usual value; the largest departures were ${fmtSigned(high.anomaly, d)} ${a.units} (${fmtMonth(high.month)}) and ${fmtSigned(low.anomaly, d)} ${a.units} (${fmtMonth(low.month)}).${run}`;
  return `${what} ${pattern} How to read it: bars that stay on one side of zero for long stretches point to a change; bars scattered on both sides are normal variability.`;
}

/** Seasonal cycle: the mean of each calendar month over the period. */
export function seasonalCaption(v: VariableResult): string {
  const a = v.analysis;
  const d = decimalsFor(v.unitGroup);
  const what = `Average ${v.name.en} for each calendar month over the selected period, in ${a.units}.`;
  const months = (a.climatology ?? []).filter((c): c is { month: number; mean: number; n: number } => typeof c.mean === "number" && Number.isFinite(c.mean));
  if (months.length === 0) return `${what} No month has a valid value.`;
  const high = months.reduce((m, c) => (c.mean > m.mean ? c : m));
  const low = months.reduce((m, c) => (c.mean < m.mean ? c : m));
  const pattern = `It is highest in ${MONTH_NAMES[high.month - 1] ?? high.month} (${fmt(high.mean, d)} ${a.units}) and lowest in ${MONTH_NAMES[low.month - 1] ?? low.month} (${fmt(low.mean, d)} ${a.units}), a seasonal range of ${fmt(high.mean - low.mean, d)} ${a.units}.`;
  return `${what} ${pattern} How to read it: this is the typical year; it shows when values peak, not whether they changed over time.`;
}

const listOf = (items: string[]) => (items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/** Comparison chart: trend per decade with its 95% interval for each variable, grouped by unit. */
export function comparisonCaption(rows: readonly DiscoveryRow[]): string {
  const estimated = rows.filter((r) => r.slopePerDecade !== null && r.ci95 !== null);
  const what = "Each dot is a variable's estimated change per decade and the line through it is its 95% interval; only variables with the same unit share an axis.";
  if (estimated.length === 0) return `${what} No trend could be estimated for these variables.`;
  const corrected = estimated.length > 1 ? " after the Benjamini–Hochberg correction" : "";
  const clear = estimated.filter((r) => r.evidence === "significant");
  const possible = estimated.filter((r) => r.evidence === "nominal").length;
  const n = estimated.length;
  let pattern =
    clear.length === 0
      ? `None of the ${n} trends is clear yet${corrected}.`
      : `${clear.length} of ${n} trends ${clear.length === 1 ? "is" : "are"} clear${corrected}: ${listOf(clear.map((r) => `${r.name} (${fmtSigned(r.slopePerDecade, decimalsFor(r.unitGroup))} ${r.trendUnits})`))}.`;
  if (possible > 0) pattern += ` ${possible} ${possible === 1 ? "is a possible trend" : "are possible trends"} that the correction does not confirm.`;
  return `${what} ${pattern} How to read it: filled dots are clear trends; if a line crosses the zero line, the trend is not clear yet.`;
}
