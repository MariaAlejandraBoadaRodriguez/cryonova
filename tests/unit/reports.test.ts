import { describe, expect, it } from "vitest";
import { discover } from "@/src/analytics/discovery";
import { buildFacts } from "@/src/agent/explain";
import { evidenceOf, qValuesFor } from "@/src/reports/narrative";
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
