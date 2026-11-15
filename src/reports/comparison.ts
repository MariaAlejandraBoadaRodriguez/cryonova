/**
 * Cell texts of the comparison (trend discovery) table, shared by the
 * dashboard and the PDF: the trend and its 95% interval in one string, the
 * adjusted p (BH q) with the raw p as a hint, and change vs. variability.
 */
import type { DiscoveryRow } from "@/src/analytics/discovery";
import { decimalsFor, fmt, fmtP, fmtSigned } from "@/src/lib/format";
import { pText } from "./narrative";

type TrendCells = Pick<DiscoveryRow, "slopePerDecade" | "ci95" | "trendUnits" | "unitGroup">;

/** "+0.30 °C/decade (+0.15 to +0.45)", or null without a trend estimate. */
export function trendWithInterval(r: TrendCells): { trend: string; interval: string; text: string } | null {
  if (r.slopePerDecade === null || r.ci95 === null) return null;
  const d = decimalsFor(r.unitGroup);
  const trend = `${fmtSigned(r.slopePerDecade, d)} ${r.trendUnits}`;
  const interval = `(${fmtSigned(r.ci95[0], d)} to ${fmtSigned(r.ci95[1], d)})`;
  return { trend, interval, text: `${trend} ${interval}` };
}

/** Adjusted p shown in the table; the raw p goes in the hint. */
export function adjustedPCell(r: Pick<DiscoveryRow, "pValue" | "qValue">): { text: string; hint: string } {
  if (r.pValue === null) return { text: "—", hint: "No trend estimate" };
  const q = r.qValue ?? r.pValue;
  return { text: fmtP(q), hint: `Raw p ${pText(r.pValue)} before the Benjamini–Hochberg correction; adjusted p (BH q) ${pText(q)}` };
}

/** "2.1× the typical year-to-year variation", or null when it cannot be computed. */
export function changeVsVariability(r: Pick<DiscoveryRow, "signalToNoise">): string | null {
  if (r.signalToNoise === null || !Number.isFinite(r.signalToNoise)) return null;
  return `${fmt(r.signalToNoise, 1)}× the typical year-to-year variation`;
}
