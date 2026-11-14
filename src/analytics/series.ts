/**
 * Monthly series operations: calendar handling, annual and seasonal means,
 * climatology, anomalies, rankings and streaks. Missing months are null and
 * are never treated as zero.
 */

export interface MonthlyPoint {
  /** YYYY-MM */
  month: string;
  value: number | null;
  validCells: number;
  totalCells: number;
}

export function parseYearMonth(ym: string): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!match) throw new Error(`Invalid year-month "${ym}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Invalid month in "${ym}"`);
  return { year, month };
}

export function formatYearMonth(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function monthsBetween(start: string, end: string): string[] {
  const a = parseYearMonth(start);
  const b = parseYearMonth(end);
  const out: string[] = [];
  let y = a.year;
  let m = a.month;
  while (y < b.year || (y === b.year && m <= b.month)) {
    out.push(formatYearMonth(y, m));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function daysInMonth(ym: string): number {
  const { year, month } = parseYearMonth(ym);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export interface AnnualMean {
  year: number;
  mean: number;
  months: number;
}

export interface ExcludedYear {
  year: number;
  months: number;
  reason: string;
}

/** Calendar-year means, keeping only years with at least `minMonths` valid months. */
export function annualMeans(points: readonly MonthlyPoint[], minMonths = 12): { annual: AnnualMean[]; excluded: ExcludedYear[] } {
  const byYear = new Map<number, number[]>();
  const requested = new Map<number, number>();
  for (const p of points) {
    const { year } = parseYearMonth(p.month);
    requested.set(year, (requested.get(year) ?? 0) + 1);
    if (p.value !== null) byYear.set(year, [...(byYear.get(year) ?? []), p.value]);
  }
  const annual: AnnualMean[] = [];
  const excluded: ExcludedYear[] = [];
  for (const year of [...requested.keys()].sort((a, b) => a - b)) {
    const values = byYear.get(year) ?? [];
    if (values.length >= minMonths) {
      annual.push({ year, mean: values.reduce((s, v) => s + v, 0) / values.length, months: values.length });
    } else {
      const inRange = requested.get(year) ?? 0;
      const reason =
        inRange < 12
          ? `Only ${inRange} of 12 months fall inside the selected period`
          : `Only ${values.length} of 12 months have valid data`;
      excluded.push({ year, months: values.length, reason });
    }
  }
  return { annual, excluded };
}

export interface ClimatologyMonth {
  month: number;
  mean: number | null;
  n: number;
}

export function climatology(points: readonly MonthlyPoint[]): ClimatologyMonth[] {
  const sums = Array.from({ length: 12 }, () => ({ sum: 0, n: 0 }));
  for (const p of points) {
    if (p.value === null) continue;
    const slot = sums[parseYearMonth(p.month).month - 1] as { sum: number; n: number };
    slot.sum += p.value;
    slot.n += 1;
  }
  return sums.map((s, i) => ({ month: i + 1, mean: s.n > 0 ? s.sum / s.n : null, n: s.n }));
}

export interface Anomaly {
  month: string;
  anomaly: number | null;
}

export function anomalies(points: readonly MonthlyPoint[], clim: readonly ClimatologyMonth[]): Anomaly[] {
  return points.map((p) => {
    const base = clim[parseYearMonth(p.month).month - 1]?.mean ?? null;
    return { month: p.month, anomaly: p.value === null || base === null ? null : p.value - base };
  });
}

export interface RankedYear extends AnnualMean {
  rank: number;
}

/** Years ranked from highest (rank 1) to lowest annual mean. */
export function annualRanking(annual: readonly AnnualMean[]): RankedYear[] {
  return [...annual].sort((a, b) => b.mean - a.mean || a.year - b.year).map((y, i) => ({ ...y, rank: i + 1 }));
}

export type Season = "DJF" | "MAM" | "JJA" | "SON";
export const SEASONS: Record<Season, number[]> = { DJF: [12, 1, 2], MAM: [3, 4, 5], JJA: [6, 7, 8], SON: [9, 10, 11] };

/**
 * Seasonal means per season-year. DJF of year Y uses December of Y-1 with
 * January and February of Y. A season needs all three months.
 */
export function seasonalMeans(points: readonly MonthlyPoint[], season: Season): AnnualMean[] {
  const lookup = new Map(points.map((p) => [p.month, p.value]));
  const years = new Set(points.map((p) => parseYearMonth(p.month).year));
  const out: AnnualMean[] = [];
  for (const year of [...years].sort((a, b) => a - b)) {
    const values = SEASONS[season].map((m) => lookup.get(formatYearMonth(season === "DJF" && m === 12 ? year - 1 : year, m)) ?? null);
    if (values.every((v): v is number => v !== null)) {
      out.push({ year, mean: values.reduce((s, v) => s + v, 0) / 3, months: 3 });
    }
  }
  return out;
}

export interface Streak {
  length: number;
  start: string;
  end: string;
}

/** Longest run of consecutive entries satisfying the predicate (nulls break runs). */
export function longestRun<T>(items: readonly T[], label: (item: T) => string, positive: (item: T) => boolean): Streak | null {
  let best: Streak | null = null;
  let startIndex = -1;
  for (let i = 0; i <= items.length; i += 1) {
    const item = items[i];
    const hit = item !== undefined && positive(item);
    if (hit && startIndex < 0) startIndex = i;
    if (!hit && startIndex >= 0) {
      const length = i - startIndex;
      if (!best || length > best.length) {
        best = { length, start: label(items[startIndex] as T), end: label(items[i - 1] as T) };
      }
      startIndex = -1;
    }
  }
  return best;
}

/** Length of the run that ends at the last entry. */
export function trailingRun<T>(items: readonly T[], positive: (item: T) => boolean): number {
  let count = 0;
  for (let i = items.length - 1; i >= 0 && positive(items[i] as T); i -= 1) count += 1;
  return count;
}
