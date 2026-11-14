/**
 * Per-variable analysis of a monthly regional series. All values are in the
 * variable's display units (exact affine conversion of provider units), so
 * slopes, intervals and anomalies can be quoted directly.
 */
import type { CatalogVariable } from "@/src/catalog/types";
import {
  type AnnualMean,
  annualMeans,
  annualRanking,
  type Anomaly,
  anomalies,
  climatology,
  type ClimatologyMonth,
  type ExcludedYear,
  longestRun,
  type MonthlyPoint,
  type RankedYear,
  type Season,
  seasonalMeans,
  type Streak,
  trailingRun,
} from "./series";
import { mean, olsHac, sampleVariance, welchTTest } from "./stats";

export const TREND_METHOD =
  "OLS of complete-year annual means on year; Newey–West HAC standard error (Bartlett kernel, 1 lag); normal-based 95% interval and p-value";

export interface TrendSummary {
  status: "ok";
  slopePerDecade: number;
  ci95PerDecade: [number, number];
  sePerDecade: number;
  pValue: number;
  z: number;
  n: number;
  firstYear: number;
  lastYear: number;
  /** Fitted change between the first and last complete years. */
  totalChange: number;
  fittedStart: number;
  fittedEnd: number;
  r2: number;
  /** Interannual standard deviation of the detrended annual means. */
  residualSd: number;
}

export interface InsufficientTrend {
  status: "insufficient";
  reason: string;
  n: number;
}

export type TrendOutcome = TrendSummary | InsufficientTrend;

export interface CoverageSummary {
  requestedMonths: number;
  monthsWithGranule: number;
  monthsValid: number;
  missingMonths: string[];
  failedMonths: string[];
  meanValidCellFraction: number | null;
  cellsPerMonth: number;
  nativeCells: number;
  stride: number;
  snapped: boolean;
  completeYears: number;
  yearsInPeriod: number;
}

export interface PeriodComparison {
  firstPeriod: [number, number];
  secondPeriod: [number, number];
  firstMean: number;
  secondMean: number;
  difference: number;
  pValue: number;
  df: number;
}

export interface VariableAnalysis {
  key: string;
  units: string;
  trendUnits: string;
  providerUnits: string;
  conversion: { scale: number; offset: number };
  monthly: MonthlyPoint[];
  coverage: CoverageSummary;
  annual: AnnualMean[];
  excludedYears: ExcludedYear[];
  trend: TrendOutcome;
  climatology: ClimatologyMonth[];
  anomalies: Anomaly[];
  ranking: RankedYear[];
  periodComparison: PeriodComparison | null;
  seasonalTrends: Array<{ season: Season; trend: TrendOutcome }>;
  streaks: {
    longestPositiveAnomalyMonths: Streak | null;
    currentPositiveAnomalyMonths: number;
    longestAboveMeanYears: Streak | null;
  };
  stats: {
    mean: number | null;
    min: { month: string; value: number } | null;
    max: { month: string; value: number } | null;
  };
  method: string;
}

export interface AnalyzeOptions {
  minYears?: number;
  minMonthsPerYear?: number;
  hacLags?: number;
}

export interface AnalyzeInput {
  variable: CatalogVariable;
  /** Monthly regional means in provider units, one per requested month. */
  points: MonthlyPoint[];
  monthsWithGranule: number;
  failedMonths: string[];
  window: { cells: number; nativeCells: number; stride: number; snapped: boolean };
}

export function toDisplay(value: number, variable: Pick<CatalogVariable, "display">): number {
  return value * variable.display.scale + variable.display.offset;
}

export function trendOf(series: readonly AnnualMean[], minYears: number, lags: number): TrendOutcome {
  if (series.length < minYears) {
    return { status: "insufficient", reason: `At least ${minYears} complete years are needed; ${series.length} available.`, n: series.length };
  }
  const years = series.map((s) => s.year);
  const values = series.map((s) => s.mean);
  const fit = olsHac(years, values, lags);
  const firstYear = years[0] as number;
  const lastYear = years[years.length - 1] as number;
  return {
    status: "ok",
    slopePerDecade: fit.slope * 10,
    ci95PerDecade: [fit.ci95[0] * 10, fit.ci95[1] * 10],
    sePerDecade: fit.seSlope * 10,
    pValue: fit.pValue,
    z: fit.z,
    n: fit.n,
    firstYear,
    lastYear,
    totalChange: fit.slope * (lastYear - firstYear),
    fittedStart: fit.intercept + fit.slope * firstYear,
    fittedEnd: fit.intercept + fit.slope * lastYear,
    r2: fit.r2,
    residualSd: Math.sqrt(sampleVariance(fit.residuals)),
  };
}

export function analyzeVariable(input: AnalyzeInput, options: AnalyzeOptions = {}): VariableAnalysis {
  const minYears = options.minYears ?? 10;
  const minMonths = options.minMonthsPerYear ?? 12;
  const lags = options.hacLags ?? 1;
  const { variable } = input;

  const monthly = input.points.map((p) => ({ ...p, value: p.value === null ? null : toDisplay(p.value, variable) }));
  const { annual, excluded } = annualMeans(monthly, minMonths);
  const clim = climatology(monthly);
  const anoms = anomalies(monthly, clim);
  const valid = monthly.filter((p): p is MonthlyPoint & { value: number } => p.value !== null);

  let periodComparison: PeriodComparison | null = null;
  if (annual.length >= 6) {
    const half = Math.floor(annual.length / 2);
    const first = annual.slice(0, half);
    const second = annual.slice(annual.length - half);
    const test = welchTTest(first.map((a) => a.mean), second.map((a) => a.mean));
    periodComparison = {
      firstPeriod: [first[0]!.year, first[first.length - 1]!.year],
      secondPeriod: [second[0]!.year, second[second.length - 1]!.year],
      firstMean: mean(first.map((a) => a.mean)),
      secondMean: mean(second.map((a) => a.mean)),
      difference: test.difference,
      pValue: test.pValue,
      df: test.df,
    };
  }

  const annualMean = annual.length > 0 ? mean(annual.map((a) => a.mean)) : Number.NaN;
  const fractions = monthly.filter((p) => p.totalCells > 0 && p.value !== null).map((p) => p.validCells / p.totalCells);
  const years = new Set(monthly.map((p) => p.month.slice(0, 4)));
  let min: { month: string; value: number } | null = null;
  let max: { month: string; value: number } | null = null;
  for (const p of valid) {
    if (!min || p.value < min.value) min = { month: p.month, value: p.value };
    if (!max || p.value > max.value) max = { month: p.month, value: p.value };
  }

  return {
    key: variable.key,
    units: variable.display.units,
    trendUnits: variable.display.trendUnits,
    providerUnits: variable.providerUnits,
    conversion: { scale: variable.display.scale, offset: variable.display.offset },
    monthly,
    coverage: {
      requestedMonths: monthly.length,
      monthsWithGranule: input.monthsWithGranule,
      monthsValid: valid.length,
      missingMonths: monthly.filter((p) => p.value === null).map((p) => p.month),
      failedMonths: input.failedMonths,
      meanValidCellFraction: fractions.length > 0 ? mean(fractions) : null,
      cellsPerMonth: input.window.cells,
      nativeCells: input.window.nativeCells,
      stride: input.window.stride,
      snapped: input.window.snapped,
      completeYears: annual.length,
      yearsInPeriod: years.size,
    },
    annual,
    excludedYears: excluded,
    trend: trendOf(annual, minYears, lags),
    climatology: clim,
    anomalies: anoms,
    ranking: annualRanking(annual),
    periodComparison,
    seasonalTrends: (["DJF", "MAM", "JJA", "SON"] as Season[]).map((season) => ({ season, trend: trendOf(seasonalMeans(monthly, season), minYears, lags) })),
    streaks: {
      longestPositiveAnomalyMonths: longestRun(anoms, (a) => a.month, (a) => a.anomaly !== null && a.anomaly > 0),
      currentPositiveAnomalyMonths: trailingRun(anoms, (a) => a.anomaly !== null && a.anomaly > 0),
      longestAboveMeanYears: annual.length > 0 ? longestRun(annual, (a) => String(a.year), (a) => a.mean > annualMean) : null,
    },
    stats: { mean: valid.length > 0 ? mean(valid.map((p) => p.value)) : null, min, max },
    method: TREND_METHOD,
  };
}

export type EvidenceLevel = "significant" | "nominal" | "inconclusive" | "insufficient";

/**
 * Statistical evidence after multiple-comparison control, kept separate from
 * practical magnitude (change relative to year-to-year variability).
 */
export function evidenceLevel(trend: TrendOutcome, qValue: number | null, alpha = 0.05): EvidenceLevel {
  if (trend.status !== "ok") return "insufficient";
  if (qValue !== null && qValue < alpha) return "significant";
  if (trend.pValue < alpha) return qValue === null ? "significant" : "nominal";
  return "inconclusive";
}

/** Fitted change over the period divided by interannual variability. */
export function signalToNoise(trend: TrendOutcome): number | null {
  if (trend.status !== "ok" || !(trend.residualSd > 0)) return null;
  return Math.abs(trend.totalChange) / trend.residualSd;
}
