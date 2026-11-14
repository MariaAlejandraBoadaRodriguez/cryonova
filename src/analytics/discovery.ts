/**
 * Trend discovery across many variables of one run: Benjamini–Hochberg
 * correction over all estimable trends, evidence levels, practical magnitude
 * (signal-to-noise) and explicit exclusions. Inconclusive results are kept so
 * the search can be audited.
 */
import type { RunResult } from "@/src/jobs/types";
import { type EvidenceLevel, evidenceLevel, signalToNoise } from "./analyze";
import { benjaminiHochberg } from "./stats";

export interface DiscoveryRow {
  key: string;
  name: string;
  product: string;
  units: string;
  trendUnits: string;
  unitGroup: string;
  slopePerDecade: number | null;
  ci95: [number, number] | null;
  pValue: number | null;
  qValue: number | null;
  n: number;
  evidence: EvidenceLevel;
  signalToNoise: number | null;
  monthsValid: number;
  monthsRequested: number;
}

export interface Discovery {
  rows: DiscoveryRow[];
  evaluated: number;
  excluded: Array<{ key: string; name: string; reason: string }>;
  correction: string;
}

export function discover(result: RunResult): Discovery {
  const ok = result.variables.filter((v) => v.analysis.trend.status === "ok");
  const q = benjaminiHochberg(ok.map((v) => (v.analysis.trend.status === "ok" ? v.analysis.trend.pValue : 1)));
  const qByKey = new Map(ok.map((v, i) => [v.key, q[i] ?? null]));
  const rows: DiscoveryRow[] = result.variables.map((v) => {
    const t = v.analysis.trend;
    const qValue = qByKey.get(v.key) ?? null;
    return {
      key: v.key,
      name: v.name.en,
      product: `${v.product} v${v.version}`,
      units: v.analysis.units,
      trendUnits: v.analysis.trendUnits,
      unitGroup: v.unitGroup,
      slopePerDecade: t.status === "ok" ? t.slopePerDecade : null,
      ci95: t.status === "ok" ? t.ci95PerDecade : null,
      pValue: t.status === "ok" ? t.pValue : null,
      qValue,
      n: t.n,
      evidence: evidenceLevel(t, ok.length > 1 ? qValue : null),
      signalToNoise: signalToNoise(t),
      monthsValid: v.analysis.coverage.monthsValid,
      monthsRequested: v.analysis.coverage.requestedMonths,
    };
  });
  const order: Record<EvidenceLevel, number> = { significant: 0, nominal: 1, inconclusive: 2, insufficient: 3 };
  rows.sort((a, b) => order[a.evidence] - order[b.evidence] || (a.qValue ?? 2) - (b.qValue ?? 2) || (b.signalToNoise ?? 0) - (a.signalToNoise ?? 0));
  return {
    rows,
    evaluated: ok.length,
    excluded: result.variables
      .filter((v) => v.analysis.trend.status !== "ok")
      .map((v) => ({ key: v.key, name: v.name.en, reason: v.analysis.coverage.monthsValid === 0 ? "No valid values in the region (check land/ocean domain and coverage)." : (v.analysis.trend as { reason: string }).reason })),
    correction: ok.length > 1 ? `Benjamini–Hochberg false discovery rate over ${ok.length} trends (q < 0.05)` : "Single trend: no multiple-comparison correction needed",
  };
}
