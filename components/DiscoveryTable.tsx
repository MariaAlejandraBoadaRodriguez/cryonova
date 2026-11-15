"use client";

/**
 * Trend comparison for multi-variable runs: a compact sortable table (trend
 * with its 95% interval in one column, evidence after Benjamini–Hochberg
 * correction with a "How to read this" hint, adjusted p with the raw p as a
 * hint, and the practical magnitude in each row's details), followed by one
 * compact chart with a panel per unit (only unit-compatible variables share
 * an axis). "No clear trend yet" results stay listed and explained.
 */
import { Fragment, useMemo, useState } from "react";
import { discover } from "@/src/analytics/discovery";
import type { RunResult } from "@/src/jobs/types";
import { comparisonCaption } from "@/src/reports/captions";
import { adjustedPCell, changeVsVariability, trendWithInterval } from "@/src/reports/comparison";
import { NO_CLEAR_TREND_NOTE } from "@/src/reports/narrative";
import { comparisonChart } from "./charts";
import { EvidenceHint } from "./EvidenceHint";
import { Plot } from "./Plot";
import { TableWrap } from "./TableWrap";

type SortKey = "evidence" | "name" | "slope" | "q";
const COLUMNS = 6;

export function DiscoveryTable({ result }: { result: RunResult }) {
  const discovery = useMemo(() => discover(result), [result]);
  const [sort, setSort] = useState<SortKey>("evidence");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => {
    const copy = [...discovery.rows];
    if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "slope") copy.sort((a, b) => Math.abs(b.slopePerDecade ?? 0) - Math.abs(a.slopePerDecade ?? 0));
    if (sort === "q") copy.sort((a, b) => (a.qValue ?? 2) - (b.qValue ?? 2));
    return copy;
  }, [discovery, sort]);
  const chart = useMemo(() => comparisonChart(discovery.rows), [discovery]);
  const caption = useMemo(() => comparisonCaption(discovery.rows), [discovery]);
  const corrected = discovery.evaluated > 1;
  const hasChart = discovery.rows.some((r) => r.slopePerDecade !== null && r.ci95 !== null);

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const header = (key: SortKey, label: string, className?: string) => (
    <th scope="col" className={className} aria-sort={sort === key ? "descending" : "none"}>
      <button type="button" className="sort-button" onClick={() => setSort(key)}>
        {label}
        {sort === key ? " ▾" : ""}
      </button>
    </th>
  );

  return (
    <section className="card stack" aria-labelledby="discovery-title" data-testid="discovery">
      <h3 id="discovery-title">Trend comparison across {result.variables.length} variables</h3>
      <p className="field-help" style={{ margin: 0 }}>
        {discovery.evaluated} trends evaluated · {discovery.correction}. Open a row&apos;s details for the change compared with year-to-year variability.
      </p>
      <TableWrap label="Trend per variable with uncertainty and multiple-comparison correction">
        <table className="data discovery-table" data-testid="discovery-table">
          <caption className="visually-hidden">Trend per variable with uncertainty and multiple-comparison correction</caption>
          <thead>
            <tr>
              {header("name", "Variable", "col-variable")}
              {header("evidence", "Evidence", "col-evidence")}
              {header("slope", "Trend per decade (95% interval)", "num col-trend")}
              {header("q", "Adjusted p (BH q)", "num col-q")}
              <th scope="col" className="num col-years">
                Years
              </th>
              <th scope="col" className="col-details">
                <span className="visually-hidden">Details</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const index = result.variables.findIndex((v) => v.key === r.key);
              const trend = trendWithInterval(r);
              const q = adjustedPCell(r);
              const magnitude = changeVsVariability(r);
              const open = expanded.has(r.key);
              const detailsId = `discovery-details-${index}`;
              return (
                <Fragment key={r.key}>
                  <tr data-testid={`discovery-row-${r.key}`}>
                    <th scope="row" className="col-variable">
                      <a href={`#var-${index}`}>{r.name}</a>
                      <div className="field-help mono" style={{ margin: 0 }}>
                        {r.product}
                      </div>
                    </th>
                    <td className="col-evidence">
                      <EvidenceHint level={r.evidence} corrected={corrected} />
                    </td>
                    <td className="num col-trend" data-testid="discovery-trend">
                      {trend ? (
                        <>
                          <span className="nowrap">{trend.trend}</span> <span className="nowrap muted">{trend.interval}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num col-q">
                      <span title={q.hint} data-testid="discovery-q">
                        {q.text}
                      </span>
                      {r.pValue !== null && <span className="visually-hidden">. {q.hint}</span>}
                    </td>
                    <td className="num col-years">{r.n}</td>
                    <td className="col-details">
                      <button type="button" className="row-details-button" aria-expanded={open} aria-controls={detailsId} onClick={() => toggle(r.key)}>
                        Details<span className="visually-hidden"> for {r.name}</span>
                      </button>
                    </td>
                  </tr>
                  <tr id={detailsId} className="discovery-details" hidden={!open}>
                    <td colSpan={COLUMNS}>
                      <dl className="kv">
                        <dt>Change vs. variability</dt>
                        <dd>{magnitude ?? "Not available (no trend estimate or no year-to-year variation)."}</dd>
                        <dt>Raw p</dt>
                        <dd>{r.pValue === null ? "—" : q.hint}</dd>
                        <dt>Valid months</dt>
                        <dd>
                          {r.monthsValid} of {r.monthsRequested}
                        </dd>
                        <dt>Chart and details</dt>
                        <dd>
                          <a href={`#var-${index}`}>Go to {r.name}</a>
                        </dd>
                      </dl>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
      <p className="field-help" style={{ margin: 0 }} data-testid="no-clear-trend-note">
        {NO_CLEAR_TREND_NOTE}
      </p>
      {discovery.excluded.length > 0 && (
        <div className="alert alert-info">
          <div>
            <strong>Excluded from the trend comparison</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {discovery.excluded.map((e) => (
                <li key={e.key}>
                  {e.name}: {e.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {hasChart && (
        <Plot {...chart} className="chart-frame-compact" testId="comparison-chart" caption={caption} ariaLabel="Trend per decade with 95% intervals for each variable, one panel per unit. Values are listed in the table above." />
      )}
    </section>
  );
}
