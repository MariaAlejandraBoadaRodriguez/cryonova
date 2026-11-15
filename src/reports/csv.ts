/**
 * CSV exports generated from a run's structured result (UTF-8, explicit
 * units, missing values left empty with status "missing", never zero).
 * Lines starting with "#" carry provenance; use comment='#' in pandas.
 */
import { discover } from "@/src/analytics/discovery";
import type { RunResult } from "@/src/jobs/types";
import { EVIDENCE_NAME, NO_CLEAR_TREND_NOTE } from "./narrative";

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function row(values: unknown[]): string {
  return values.map(cell).join(",");
}

function header(result: RunResult, kind: string, ids: { investigationId?: string | null }): string[] {
  const s = result.sources[0];
  return [
    `# Cryonova ${kind}`,
    `# run_id: ${result.runId}`,
    `# investigation_id: ${ids.investigationId ?? "not saved"}`,
    `# question: ${(result.selection.question ?? "").replace(/[\r\n]+/g, " ")}`,
    `# region: ${result.region.name ?? "custom box"}; bbox west=${result.region.bbox.west} south=${result.region.bbox.south} east=${result.region.bbox.east} north=${result.region.bbox.north}`,
    `# period: ${result.selection.start} to ${result.selection.end}`,
    `# extracted_from_provider: ${s?.fetchedFrom ?? ""} to ${s?.fetchedTo ?? ""} (UTC)`,
    `# sources: ${result.sources.map((x) => `${x.collection} v${x.version} (${x.conceptId}${x.doi ? `, doi:${x.doi}` : ""})`).join("; ")}`,
    `# method: ${result.variables[0]?.analysis.method ?? ""}; cos-latitude weighted regional means`,
  ];
}

/** One row per variable: trend, uncertainty, multiple-comparison q-value and coverage. */
export function resultsCsv(result: RunResult, ids: { investigationId?: string | null } = {}): string {
  const discovery = discover(result);
  const lines = header(result, "results table", ids);
  lines.push(
    `# evidence: "${EVIDENCE_NAME.significant}" = the 95% interval excludes zero (and the trend stays significant after the Benjamini-Hochberg correction when several trends are compared); "${EVIDENCE_NAME.nominal}" = the interval excludes zero but not after the correction; "${EVIDENCE_NAME.inconclusive}" = the interval includes zero; "${EVIDENCE_NAME.insufficient}" = too few complete years for a trend; evidence_level is the stable code`,
    `# ${NO_CLEAR_TREND_NOTE}`,
  );
  lines.push(
    row(["variable_key", "variable_name", "product", "slope_per_decade", "slope_units", "ci95_low", "ci95_high", "p_value", "q_value_bh", "evidence", "complete_years", "first_year", "last_year", "fitted_change", "value_units", "period_mean", "months_valid", "months_requested", "mean_valid_cell_percent", "status", "evidence_level"]),
  );
  for (const r of discovery.rows) {
    const v = result.variables.find((x) => x.key === r.key)!;
    const t = v.analysis.trend;
    const cov = v.analysis.coverage;
    lines.push(
      row([
        r.key, r.name, r.product, r.slopePerDecade, r.trendUnits, r.ci95?.[0], r.ci95?.[1], r.pValue, r.qValue, EVIDENCE_NAME[r.evidence], r.n,
        t.status === "ok" ? t.firstYear : null, t.status === "ok" ? t.lastYear : null, t.status === "ok" ? t.totalChange : null, r.units,
        v.analysis.stats.mean, cov.monthsValid, cov.requestedMonths, cov.meanValidCellFraction === null ? null : cov.meanValidCellFraction * 100,
        t.status === "ok" ? "ok" : `insufficient: ${t.reason}`,
        r.evidence,
      ]),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Long-format monthly series: one row per variable and month, units explicit. */
export function seriesCsv(result: RunResult, ids: { investigationId?: string | null } = {}): string {
  const lines = header(result, "monthly series", ids);
  lines.push(row(["variable_key", "month", "value", "units", "valid_cells", "total_cells", "status"]));
  for (const v of result.variables) {
    for (const p of v.analysis.monthly) {
      lines.push(row([v.key, p.month, p.value, v.analysis.units, p.validCells, p.totalCells, p.value === null ? "missing" : "ok"]));
    }
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
