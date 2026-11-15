import { describe, expect, it } from "vitest";
import { comparisonChart, wrapLabel } from "@/components/charts";
import { evidenceLevel, type EvidenceLevel, type TrendSummary } from "@/src/analytics/analyze";
import { discover, type DiscoveryRow } from "@/src/analytics/discovery";
import { buildFacts, explainWithRules } from "@/src/agent/explain";
import type { VariableResult } from "@/src/jobs/types";
import { anomalyCaption, comparisonCaption, seasonalCaption, seriesCaption } from "@/src/reports/captions";
import { adjustedPCell, changeVsVariability, trendWithInterval } from "@/src/reports/comparison";
import { EVIDENCE_LABEL, EVIDENCE_NAME, evidenceMeaning, evidenceOf, NO_CLEAR_TREND_NOTE, qValuesFor } from "@/src/reports/narrative";
import { monthsBetween } from "@/src/analytics/series";
import { lookupInvestigation, saveInvestigation } from "@/src/db/investigations";
import { buildResult } from "@/src/jobs/runner";
import { SelectionSchema } from "@/src/jobs/selection";
import type { RunRow, SampleRow } from "@/src/jobs/types";
import { resultsCsv, seriesCsv } from "@/src/reports/csv";
import { buildPdf, pdfSafe } from "@/src/reports/pdf";

function syntheticResult() {
  const selection = SelectionSchema.parse({
    question: "Which variables changed in Colombia?",
    region: { bbox: { west: -79, south: -4.2, east: -66.85, north: 12.5 }, name: "Colombia", regionId: "country:CO", source: "named" },
    start: "2005-01",
    end: "2016-12",
    variables: ["merra2.T2M", "merra2.QV2M", "merra2.GWETTOP"],
  });
  const months = monthsBetween(selection.start, selection.end);
  const samples: SampleRow[] = [];
  months.forEach((month, i) => {
    const slv = month === "2010-06" ? null : [
      { key: "merra2.T2M", mean: 298 + 0.004 * i + Math.sin(i / 2) * 0.3, validCells: 680, totalCells: 680 },
      { key: "merra2.QV2M", mean: 0.016 + Math.cos(i) * 0.0002, validCells: 680, totalCells: 680 },
    ];
    samples.push({ runId: "r", collection: "M2TMNXSLV", month, status: slv ? "ok" : "failed", granuleId: month, granuleTitle: `G${month}`, opendapUrl: `https://opendap.earthdata.nasa.gov/g/${month}`, values: slv, bytes: 100, durationMs: 1200, attempts: 1, error: slv ? null : "timeout: no response", fetchedAt: new Date("2026-11-14T21:00:00Z") });
    samples.push({ runId: "r", collection: "M2TMNXLND", month, status: "ok", granuleId: month, granuleTitle: `L${month}`, opendapUrl: `https://opendap.earthdata.nasa.gov/l/${month}`, values: [{ key: "merra2.GWETTOP", mean: null, validCells: 0, totalCells: 680 }], bytes: 100, durationMs: 900, attempts: 1, error: null, fetchedAt: new Date("2026-11-14T21:00:01Z") });
  });
  const run = { id: "11111111-2222-3333-4444-555555555555", createdAt: new Date("2026-11-14T20:59:00Z"), startedAt: new Date("2026-11-14T20:59:01Z") } as RunRow;
  return buildResult(run, selection, samples, { discoveryMs: 300, readWallMs: 40_000, analysisStart: Date.now(), invocationStart: Date.now(), concurrency: 6, invocations: 1 });
}

describe("trend discovery", () => {
  const result = syntheticResult();

  it("applies BH across estimable trends, keeps inconclusive results and lists exclusions", () => {
    expect(result.status).toBe("partial");
    const d = discover(result);
    expect(d.evaluated).toBe(2);
    expect(d.correction).toMatch(/Benjamini–Hochberg/);
    expect(d.rows[0]?.key).toBe("merra2.T2M");
    expect(d.rows[0]?.evidence).toBe("significant");
    expect(d.rows.find((r) => r.key === "merra2.QV2M")?.evidence).toMatch(/inconclusive|nominal/);
    expect(d.excluded).toEqual([expect.objectContaining({ key: "merra2.GWETTOP", reason: expect.stringMatching(/No valid values/) })]);
    expect(result.warnings.join(" ")).toMatch(/1 monthly reads failed/);
  });
});

describe("exports", () => {
  const result = syntheticResult();

  it("writes a results CSV with provenance, units and q-values", () => {
    const csv = resultsCsv(result, { investigationId: "inv-1" });
    expect(csv.startsWith("﻿# Cryonova results table")).toBe(true);
    expect(csv).toContain("# investigation_id: inv-1");
    expect(csv).toContain("# sources: M2TMNXSLV v5.12.4 (C1276812859-GES_DISC, doi:10.5067/AP1B0BA5PD2K)");
    const lines = csv.trim().split("\r\n").filter((l) => !l.startsWith("#") && !l.startsWith("﻿#"));
    expect(lines[0]).toMatch(/^variable_key,variable_name,product,slope_per_decade,slope_units,ci95_low/);
    expect(lines).toHaveLength(4);
    expect(lines.find((l) => l.startsWith("merra2.T2M"))).toMatch(/°C\/decade/);
  });

  it("writes a long series CSV where missing months are empty with status missing, never zero", () => {
    const csv = seriesCsv(result);
    expect(csv).toContain("merra2.T2M,2010-06,,°C,0,0,missing");
    expect(csv).toMatch(/merra2\.T2M,2005-01,24\.85\d*,°C,680,680,ok/);
  });

  it("builds a PDF with standard fonts and safe text", async () => {
    const bytes = await buildPdf(result, { code: "ABCD-EFGH-JKMN", investigationId: "inv-1", generatedAt: new Date("2026-11-14T21:05:00Z") });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(4000);
    expect(pdfSafe("−0.3 °C ≈ 2 m² → ok ✓ 中")).toBe("-0.3 °C ~ 2 m2 -> ok OK ?");
  });
});

describe("saved investigations (memory store)", () => {
  it("saves with a random code and reopens only with that code, throttling failures", async () => {
    delete process.env.DATABASE_URL;
    process.env.CODE_LOOKUP_FAILURES_PER_10_MIN = "3";
    const result = syntheticResult();
    const saved = await saveInvestigation({ runId: result.runId, question: "q", result, explanation: null });
    expect(saved.code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const found = await lookupInvestigation(saved.code.toLowerCase().replace(/-/g, " "), "client-a");
    expect(found.status).toBe("found");
    if (found.status === "found") expect(found.snapshot.result.runId).toBe(result.runId);
    expect((await lookupInvestigation("ZZZZ-ZZZZ-ZZZZ", "client-b")).status).toBe("not_found");
    expect((await lookupInvestigation("not a code", "client-b")).status).toBe("invalid");
    expect((await lookupInvestigation("YYYY-YYYY-YYYY", "client-b")).status).toBe("not_found");
    expect((await lookupInvestigation(saved.code, "client-b")).status).toBe("throttled");
    expect((await lookupInvestigation(saved.code, "client-c")).status).toBe("found");
    delete process.env.CODE_LOOKUP_FAILURES_PER_10_MIN;
  });
});

describe("multiple-comparison consistency", () => {
  it("uses BH-corrected evidence in explanation facts and variable badges when several trends are tested", () => {
    const result = syntheticResult();
    const facts = buildFacts(result);
    expect(facts.multipleComparison).toMatch(/Benjamini-Hochberg false discovery rate over 2 trends/);
    const q = qValuesFor(result);
    expect(q.size).toBe(2);
    const t2m = result.variables.find((v) => v.key === "merra2.T2M")!;
    expect(facts.variables.find((v) => v.key === "merra2.T2M")?.multipleComparisonQValue).not.toBeNull();
    expect(evidenceOf(t2m, q.get(t2m.key) ?? null)).toBe(discover(result).rows.find((r) => r.key === "merra2.T2M")?.evidence);
    expect(qValuesFor({ variables: result.variables.slice(0, 1) }).size).toBe(0);
  });
});

const TREND: TrendSummary = {
  status: "ok",
  slopePerDecade: 0.3,
  ci95PerDecade: [0.15, 0.45],
  sePerDecade: 0.0765,
  pValue: 0.004,
  z: 3.92,
  n: 10,
  firstYear: 2015,
  lastYear: 2024,
  totalChange: 0.27,
  fittedStart: 24.8,
  fittedEnd: 25.07,
  r2: 0.6,
  residualSd: 0.12,
};

/** A variable with fixed numbers, shaped like a stored result (only the fields the captions read). */
function fixedVariable(trend: VariableResult["analysis"]["trend"] = TREND): VariableResult {
  return {
    key: "merra2.T2M",
    name: { en: "Near-surface air temperature (2 m)" },
    unitGroup: "temperature",
    analysis: {
      units: "°C",
      trendUnits: "°C/decade",
      trend,
      anomalies: [
        { month: "2015-01", anomaly: -0.4 },
        { month: "2015-02", anomaly: 0.25 },
        { month: "2015-03", anomaly: null },
        { month: "2015-04", anomaly: 0.61 },
        { month: "2015-05", anomaly: 0.1 },
      ],
      climatology: [
        { month: 1, mean: 24.1, n: 10 },
        { month: 4, mean: 25.36, n: 10 },
        { month: 7, mean: 24.9, n: 10 },
        { month: 9, mean: null, n: 0 },
      ],
      streaks: { longestPositiveAnomalyMonths: { length: 2, start: "2015-04", end: "2015-05" }, currentPositiveAnomalyMonths: 2, longestAboveMeanYears: null },
    },
  } as unknown as VariableResult;
}

function row(partial: Partial<DiscoveryRow>): DiscoveryRow {
  return {
    key: "k",
    name: "Variable",
    product: "P v1",
    units: "°C",
    trendUnits: "°C/decade",
    unitGroup: "temperature",
    slopePerDecade: 0.3,
    ci95: [0.15, 0.45],
    pValue: 0.004,
    qValue: 0.008,
    n: 10,
    evidence: "significant",
    signalToNoise: 2.25,
    monthsValid: 120,
    monthsRequested: 120,
    ...partial,
  };
}

describe("evidence labels", () => {
  it("maps every evidence level to a clear, honest name", () => {
    expect(EVIDENCE_NAME).toEqual({ significant: "Clear trend", nominal: "Possible trend, not confirmed", inconclusive: "No clear trend yet", insufficient: "Not enough data" });
    const name = (trend: VariableResult["analysis"]["trend"], q: number | null) => EVIDENCE_NAME[evidenceLevel(trend, q)];
    const flat: TrendSummary = { ...TREND, slopePerDecade: 0.1, pValue: 0.3, ci95PerDecade: [-0.1, 0.3] };
    expect(name(TREND, null)).toBe("Clear trend");
    expect(name(TREND, 0.01)).toBe("Clear trend");
    expect(name(TREND, 0.2)).toBe("Possible trend, not confirmed");
    expect(name(flat, null)).toBe("No clear trend yet");
    expect(name(flat, 0.4)).toBe("No clear trend yet");
    expect(name({ status: "insufficient", reason: "At least 10 complete years are needed; 6 available.", n: 6 }, null)).toBe("Not enough data");
  });

  it("explains each label in plain language without overstating", () => {
    expect(evidenceMeaning("significant", false)).toMatch(/95% interval of the trend excludes zero/);
    expect(evidenceMeaning("significant", false)).not.toMatch(/Benjamini/);
    expect(evidenceMeaning("significant", true)).toMatch(/excludes zero and the trend stays significant after the Benjamini–Hochberg correction/);
    expect(evidenceMeaning("nominal", true)).toMatch(/not significant after the Benjamini–Hochberg correction.*may be a chance result/);
    expect(evidenceMeaning("inconclusive", true)).toMatch(/includes zero: the data cannot separate the change from natural year-to-year variation/);
    expect(evidenceMeaning("insufficient", false)).toMatch(/at least 10 are needed/);
    for (const level of Object.keys(EVIDENCE_NAME) as EvidenceLevel[]) expect(EVIDENCE_LABEL[level].startsWith(`${EVIDENCE_NAME[level]}: `)).toBe(true);
    expect(NO_CLEAR_TREND_NOTE).toBe("No clear trend yet means the data cannot separate the change from natural year-to-year variation in this period; a longer period or a different region may help.");
  });

  it("uses the same wording in the AI facts, and the numeric verifier still passes the rules explanation", () => {
    const result = syntheticResult();
    const facts = buildFacts(result);
    expect(facts.variables.find((v) => v.key === "merra2.T2M")?.evidence).toBe(EVIDENCE_LABEL.significant);
    const rules = explainWithRules(result);
    expect(rules.verification.unverified).toEqual([]);
    expect(rules.verification.checked).toBeGreaterThan(5);
  });
});

describe("chart captions", () => {
  it("describes the main chart, its pattern and how to read it from the numbers", () => {
    expect(seriesCaption(fixedVariable())).toBe(
      "Monthly regional mean of Near-surface air temperature (2 m) in °C (thin line), annual means of complete years (dots) and the fitted linear trend (dashed) with its 95% interval (shaded band). From 2015 to 2024 it rose by 0.30 °C/decade (95% interval +0.15 to +0.45): a clear trend. How to read it: if a flat line fits inside the shaded band, the interval includes zero and the trend is not clear yet.",
    );
    expect(seriesCaption(fixedVariable({ ...TREND, slopePerDecade: -0.05, ci95PerDecade: [-0.2, 0.1], pValue: 0.5 }))).toContain(
      "From 2015 to 2024 the estimate is -0.05 °C/decade, but its 95% interval (-0.20 to +0.10) includes zero, so there is no clear trend yet.",
    );
    expect(seriesCaption(fixedVariable({ status: "insufficient", reason: "At least 10 complete years are needed; 6 available.", n: 6 }))).toContain(
      "No trend line is drawn: At least 10 complete years are needed; 6 available.",
    );
  });

  it("summarizes the anomalies and the seasonal cycle, also for results saved without them", () => {
    expect(anomalyCaption(fixedVariable())).toBe(
      "Each bar is one month's departure from the average of that calendar month over the selected period (red above zero, blue below). 3 of 4 months were above their usual value; the largest departures were +0.61 °C (Apr 2015) and -0.40 °C (Jan 2015). The longest run above the usual value lasted 2 months (Apr 2015 – May 2015). How to read it: bars that stay on one side of zero for long stretches point to a change; bars scattered on both sides are normal variability.",
    );
    expect(seasonalCaption(fixedVariable())).toBe(
      "Average Near-surface air temperature (2 m) for each calendar month over the selected period, in °C. It is highest in April (25.36 °C) and lowest in January (24.10 °C), a seasonal range of 1.26 °C. How to read it: this is the typical year; it shows when values peak, not whether they changed over time.",
    );
    const old = fixedVariable();
    const analysis = old.analysis as unknown as Record<string, unknown>;
    delete analysis.anomalies;
    delete analysis.climatology;
    delete analysis.streaks;
    expect(anomalyCaption(old)).toMatch(/No month has a valid value/);
    expect(seasonalCaption(old)).toMatch(/No month has a valid value/);
  });

  it("summarizes the comparison chart, counting clear and unconfirmed trends", () => {
    const rows = [
      row({ key: "a", name: "Air temperature" }),
      row({ key: "b", name: "Dew point", slopePerDecade: 0.21, ci95: [0.02, 0.4], pValue: 0.03, qValue: 0.06, evidence: "nominal" }),
      row({ key: "c", name: "Humidity", units: "g/kg", trendUnits: "g/kg/decade", unitGroup: "specific_humidity", slopePerDecade: 0.012, ci95: [-0.01, 0.034], pValue: 0.3, qValue: 0.3, evidence: "inconclusive" }),
      row({ key: "d", name: "Soil wetness", slopePerDecade: null, ci95: null, pValue: null, qValue: null, evidence: "insufficient" }),
    ];
    expect(comparisonCaption(rows)).toBe(
      "Each dot is a variable's estimated change per decade and the line through it is its 95% interval; only variables with the same unit share an axis. 1 of 3 trends is clear after the Benjamini–Hochberg correction: Air temperature (+0.30 °C/decade). 1 is a possible trend that the correction does not confirm. How to read it: filled dots are clear trends; if a line crosses the zero line, the trend is not clear yet.",
    );
    expect(comparisonCaption([rows[2]!])).toContain("None of the 1 trends is clear yet.");
    expect(comparisonCaption([rows[3]!])).toContain("No trend could be estimated");
  });
});

describe("comparison table and chart", () => {
  it("merges the trend and its 95% interval into one string and keeps the raw p as a hint", () => {
    expect(trendWithInterval(row({}))).toEqual({ trend: "+0.30 °C/decade", interval: "(+0.15 to +0.45)", text: "+0.30 °C/decade (+0.15 to +0.45)" });
    expect(trendWithInterval(row({ slopePerDecade: -0.0123, ci95: [-0.02, -0.0046], trendUnits: "g/kg/decade", unitGroup: "specific_humidity" }))?.text).toBe("-0.012 g/kg/decade (-0.020 to -0.005)");
    expect(trendWithInterval(row({ slopePerDecade: null, ci95: null }))).toBeNull();
    expect(adjustedPCell(row({}))).toEqual({ text: "0.008", hint: "Raw p = 0.004 before the Benjamini–Hochberg correction; adjusted p (BH q) = 0.008" });
    expect(adjustedPCell(row({ pValue: 0.0002, qValue: 0.0004 }))).toEqual({ text: "< 0.001", hint: "Raw p < 0.001 before the Benjamini–Hochberg correction; adjusted p (BH q) < 0.001" });
    expect(adjustedPCell(row({ pValue: 0.03, qValue: null })).text).toBe("0.030");
    expect(adjustedPCell(row({ pValue: null, qValue: null }))).toEqual({ text: "—", hint: "No trend estimate" });
    expect(changeVsVariability(row({}))).toBe("2.3× the typical year-to-year variation");
    expect(changeVsVariability(row({ signalToNoise: null }))).toBeNull();
  });

  it("draws one compact figure with a panel per unit and zero always in range", () => {
    const rows = [
      row({ key: "a", name: "Air temperature" }),
      row({ key: "b", name: "Dew point temperature at two metres above the ground", slopePerDecade: 0.2, ci95: [0.1, 0.3] }),
      row({ key: "c", name: "Humidity", trendUnits: "g/kg/decade", unitGroup: "specific_humidity", slopePerDecade: 0.012, ci95: [-0.01, 0.034], evidence: "inconclusive" }),
      row({ key: "d", name: "Soil wetness", slopePerDecade: null, ci95: null, evidence: "insufficient" }),
    ];
    const { data, layout } = comparisonChart(rows);
    expect(data).toHaveLength(2);
    const x1 = layout.xaxis as { range: [number, number]; zeroline: boolean };
    const x2 = layout.xaxis2 as { range: [number, number] };
    expect(x1.zeroline).toBe(true);
    expect(x1.range[0]).toBeLessThan(0);
    expect(x1.range[1]).toBeGreaterThan(0.45);
    expect(x2.range[0]).toBeLessThan(-0.01);
    expect(layout.height as number).toBeLessThan(320);
    const top = (layout.yaxis as { domain: [number, number] }).domain;
    const bottom = (layout.yaxis2 as { domain: [number, number] }).domain;
    expect(top[0]).toBeGreaterThan(bottom[1]);
    expect((data[0] as { marker: { color: string[] } }).marker.color).toEqual(["#0042A6", "#0042A6"]);
    expect((data[1] as { marker: { color: string[] } }).marker.color).toEqual(["#FFFFFF"]);
    expect(wrapLabel("Dew point temperature at two metres above the ground")).toBe("Dew point temperature at<br>two metres above the<br>ground");
  });

  it("writes the same evidence wording in the results CSV, with the stable code last", () => {
    const csv = resultsCsv(syntheticResult());
    expect(csv).toContain(`# ${NO_CLEAR_TREND_NOTE}`);
    const lines = csv
      .replace(/^﻿/, "")
      .trim()
      .split("\r\n")
      .filter((l) => !l.startsWith("#"));
    expect(lines[0]?.endsWith(",status,evidence_level")).toBe(true);
    expect(lines.find((l) => l.startsWith("merra2.T2M"))).toMatch(/,Clear trend,.*,ok,significant$/);
    expect(lines.find((l) => l.startsWith("merra2.GWETTOP"))).toMatch(/,Not enough data,.*,insufficient$/);
  });
});
