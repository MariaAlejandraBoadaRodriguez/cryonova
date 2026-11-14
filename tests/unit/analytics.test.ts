import { describe, expect, it } from "vitest";
import { getVariable } from "@/src/catalog";
import { analyzeVariable, evidenceLevel, signalToNoise, toDisplay, trendOf } from "@/src/analytics/analyze";
import {
  annualMeans,
  anomalies,
  climatology,
  daysInMonth,
  longestRun,
  type MonthlyPoint,
  monthsBetween,
  parseYearMonth,
  seasonalMeans,
  trailingRun,
} from "@/src/analytics/series";
import { benjaminiHochberg, olsHac } from "@/src/analytics/stats";

const t2m = getVariable("merra2.T2M")!;

function syntheticKelvin(startYear: number, years: number, slopePerYear: number, drop: string[] = []): MonthlyPoint[] {
  return monthsBetween(`${startYear}-01`, `${startYear + years - 1}-12`).map((month, i) => {
    const { month: m } = parseYearMonth(month);
    const value = 290 + slopePerYear * (i / 12) + 3 * Math.sin(((m - 1) / 12) * 2 * Math.PI) + 0.05 * Math.cos(i * 1.7);
    return { month, value: drop.includes(month) ? null : value, validCells: 100, totalCells: 100 };
  });
}

describe("calendar helpers", () => {
  it("enumerates months and days", () => {
    expect(monthsBetween("2004-11", "2005-02")).toEqual(["2004-11", "2004-12", "2005-01", "2005-02"]);
    expect(daysInMonth("2000-02")).toBe(29);
    expect(daysInMonth("1900-02")).toBe(28);
    expect(() => parseYearMonth("2005-13")).toThrow();
    expect(() => parseYearMonth("05-1")).toThrow();
  });
});

describe("series operations", () => {
  const points = syntheticKelvin(2001, 3, 0, ["2002-07"]);

  it("keeps complete years and explains exclusions", () => {
    const { annual, excluded } = annualMeans(points);
    expect(annual.map((a) => a.year)).toEqual([2001, 2003]);
    expect(excluded).toEqual([{ year: 2002, months: 11, reason: "Only 11 of 12 months have valid data" }]);
    const partial = annualMeans(points.slice(0, 18));
    expect(partial.excluded[0]?.reason).toBe("Only 6 of 12 months fall inside the selected period");
  });

  it("computes climatology and anomalies without treating gaps as zero", () => {
    const clim = climatology(points);
    expect(clim).toHaveLength(12);
    expect(clim[6]?.n).toBe(2);
    const anoms = anomalies(points, clim);
    expect(anoms.find((a) => a.month === "2002-07")?.anomaly).toBeNull();
  });

  it("builds DJF across the year boundary and requires all three months", () => {
    const djf = seasonalMeans(points, "DJF");
    expect(djf.map((s) => s.year)).toEqual([2002, 2003]);
    expect(seasonalMeans(points, "JJA").map((s) => s.year)).toEqual([2001, 2003]);
  });

  it("finds the longest and trailing runs", () => {
    const flags = [1, 1, 0, 1, 1, 1, 0, 1].map((v, i) => ({ label: String(i), v }));
    expect(longestRun(flags, (f) => f.label, (f) => f.v === 1)).toEqual({ length: 3, start: "3", end: "5" });
    expect(trailingRun(flags, (f) => f.v === 1)).toBe(1);
    expect(longestRun([], String, () => true)).toBeNull();
  });
});

describe("variable analysis", () => {
  const points = syntheticKelvin(2001, 24, 0.03, ["2010-03"]);
  const analysis = analyzeVariable({ variable: t2m, points, monthsWithGranule: 288, failedMonths: [], window: { cells: 680, nativeCells: 680, stride: 1, snapped: false } });

  it("converts Kelvin to Celsius for display", () => {
    expect(toDisplay(273.15, t2m)).toBeCloseTo(0, 12);
    expect(analysis.units).toBe("°C");
    expect(analysis.monthly[0]?.value).toBeCloseTo(290 - 273.15 + 0.05, 6);
  });

  it("recovers the trend per decade with an interval that contains it", () => {
    expect(analysis.trend.status).toBe("ok");
    if (analysis.trend.status !== "ok") return;
    expect(analysis.trend.slopePerDecade).toBeCloseTo(0.3, 2);
    expect(analysis.trend.ci95PerDecade[0]).toBeLessThan(0.3);
    expect(analysis.trend.ci95PerDecade[1]).toBeGreaterThan(0.3);
    expect(analysis.trend.n).toBe(23);
    expect(analysis.trend.totalChange).toBeCloseTo(0.03 * 23, 1);
    expect(analysis.trend.pValue).toBeLessThan(1e-6);
  });

  it("reports coverage, exclusions and extra analyses", () => {
    expect(analysis.coverage).toMatchObject({ requestedMonths: 288, monthsValid: 287, missingMonths: ["2010-03"], completeYears: 23, yearsInPeriod: 24, meanValidCellFraction: 1 });
    expect(analysis.excludedYears.map((e) => e.year)).toEqual([2010]);
    expect(analysis.ranking[0]?.rank).toBe(1);
    expect(analysis.ranking[0]!.year).toBeGreaterThan(2015);
    expect(analysis.periodComparison?.difference).toBeGreaterThan(0);
    expect(analysis.seasonalTrends).toHaveLength(4);
    expect(analysis.streaks.longestAboveMeanYears?.end).toBe("2024");
    expect(analysis.stats.max?.value).toBeGreaterThan(analysis.stats.min!.value);
  });

  it("refuses to estimate a trend from too few years", () => {
    const short = analyzeVariable({ variable: t2m, points: syntheticKelvin(2015, 5, 0.03), monthsWithGranule: 60, failedMonths: [], window: { cells: 1, nativeCells: 1, stride: 1, snapped: true } });
    expect(short.trend).toMatchObject({ status: "insufficient", n: 5 });
    expect(evidenceLevel(short.trend, null)).toBe("insufficient");
    expect(signalToNoise(short.trend)).toBeNull();
  });

  it("separates statistical evidence from practical magnitude", () => {
    const flat = trendOf(Array.from({ length: 15 }, (_, i) => ({ year: 2000 + i, mean: 10 + (i % 2) * 0.5, months: 12 })), 10, 1);
    expect(evidenceLevel(flat, null)).toBe("inconclusive");
    expect(evidenceLevel(analysis.trend, 0.01)).toBe("significant");
    expect(evidenceLevel(analysis.trend, 0.2)).toBe("nominal");
    expect(signalToNoise(analysis.trend)).toBeGreaterThan(1);
  });

  it("guards OLS inputs and keeps BH adjustments monotone", () => {
    expect(() => olsHac([1, 2], [1, 2])).toThrow();
    expect(() => olsHac([1, 1, 1], [1, 2, 3])).toThrow();
    expect(() => olsHac([1, 2, 3], [1, 2])).toThrow();
    const q = benjaminiHochberg([0.01, 0.04, 0.03, 0.5]);
    expect(q[0]).toBeLessThanOrEqual(q[2]!);
    expect(q.every((v) => v <= 1)).toBe(true);
  });
});
