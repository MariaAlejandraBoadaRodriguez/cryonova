"use client";

/**
 * Trend discovery view for multi-variable runs: sortable table with evidence
 * after Benjamini–Hochberg correction, practical magnitude, exclusions, and a
 * slope-with-interval chart per unit group (only unit-compatible variables
 * are compared directly).
 */
import { useMemo, useState } from "react";
import { discover, type DiscoveryRow } from "@/src/analytics/discovery";
import type { RunResult } from "@/src/jobs/types";
import { fmt, fmtP, fmtSigned } from "@/src/lib/format";
import { COLORS } from "./charts";
import { Plot } from "./Plot";
import { TableWrap } from "./TableWrap";

type SortKey = "evidence" | "name" | "slope" | "q" | "snr";
const LABEL: Record<DiscoveryRow["evidence"], string> = { significant: "Significant (FDR)", nominal: "Nominal only", inconclusive: "Inconclusive", insufficient: "Insufficient data" };

export function DiscoveryTable({ result }: { result: RunResult }) {
  const discovery = useMemo(() => discover(result), [result]);
  const [sort, setSort] = useState<SortKey>("evidence");
  const rows = useMemo(() => {
    const copy = [...discovery.rows];
    if (sort === "name") copy.sort((a, b) => a.name.localeCompare(b.name));
    if (sort === "slope") copy.sort((a, b) => Math.abs(b.slopePerDecade ?? 0) - Math.abs(a.slopePerDecade ?? 0));
    if (sort === "q") copy.sort((a, b) => (a.qValue ?? 2) - (b.qValue ?? 2));
    if (sort === "snr") copy.sort((a, b) => (b.signalToNoise ?? -1) - (a.signalToNoise ?? -1));
    return copy;
  }, [discovery, sort]);

  const groups = useMemo(() => {
    const map = new Map<string, DiscoveryRow[]>();
    for (const r of discovery.rows) if (r.slopePerDecade !== null) map.set(r.trendUnits, [...(map.get(r.trendUnits) ?? []), r]);
    return [...map.entries()];
  }, [discovery]);

  const header = (key: SortKey, label: string, numeric = false) => (
    <th scope="col" className={numeric ? "num" : undefined} aria-sort={sort === key ? "descending" : "none"}>
      <button type="button" className="btn btn-ghost btn-small" style={{ border: 0, padding: 0, minHeight: 0 }} onClick={() => setSort(key)}>
        {label}
        {sort === key ? " ▾" : ""}
      </button>
    </th>
  );

  return (
    <section className="card stack" aria-labelledby="discovery-title" data-testid="discovery">
      <h3 id="discovery-title">Trend discovery across {result.variables.length} variables</h3>
      <p className="field-help" style={{ margin: 0 }}>
        {discovery.evaluated} trends evaluated · {discovery.correction}. Statistical evidence and practical magnitude (fitted change divided by year-to-year variability) are shown separately; inconclusive results stay listed.
      </p>
      <TableWrap label="Trend per variable with uncertainty and multiple-comparison correction">
        <table className="data">
          <caption className="visually-hidden">Trend per variable with uncertainty and multiple-comparison correction</caption>
          <thead>
            <tr>
              {header("name", "Variable")}
              {header("evidence", "Evidence")}
              {header("slope", "Trend per decade", true)}
              <th scope="col" className="num">
                95% CI
              </th>
              <th scope="col" className="num">
                p
              </th>
              {header("q", "Adjusted p (BH q)", true)}
              {header("snr", "Change / variability", true)}
              <th scope="col" className="num">
                Years
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  <a href={`#var-${result.variables.findIndex((v) => v.key === r.key)}`}>{r.name}</a>
                  <div className="field-help mono" style={{ margin: 0 }}>
                    {r.product}
                  </div>
                </th>
                <td>
                  <span className={r.evidence === "significant" ? "badge badge-strong" : "badge badge-neutral"}>{LABEL[r.evidence]}</span>
                </td>
                <td className="num">{r.slopePerDecade === null ? "—" : `${fmtSigned(r.slopePerDecade, 3)} ${r.trendUnits}`}</td>
                <td className="num">{r.ci95 ? `${fmtSigned(r.ci95[0], 3)} to ${fmtSigned(r.ci95[1], 3)}` : "—"}</td>
                <td className="num">{fmtP(r.pValue)}</td>
                <td className="num">{fmtP(r.qValue)}</td>
                <td className="num">{r.signalToNoise === null ? "—" : `${fmt(r.signalToNoise, 1)}×`}</td>
                <td className="num">{r.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
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
      {groups.map(([units, items]) => (
        <Plot
          key={units}
          className="chart-frame"
          ariaLabel={`Trend per decade with 95% intervals for variables measured in ${units}. Values are listed in the table above.`}
          data={[
            {
              type: "scatter",
              mode: "markers",
              x: items.map((r) => r.slopePerDecade),
              y: items.map((r) => r.name),
              error_x: { type: "data", symmetric: false, array: items.map((r) => (r.ci95 ? r.ci95[1] - (r.slopePerDecade ?? 0) : 0)), arrayminus: items.map((r) => (r.ci95 ? (r.slopePerDecade ?? 0) - r.ci95[0] : 0)), color: COLORS.trend, thickness: 1.5, width: 6 },
              marker: { size: 10, color: items.map((r) => (r.evidence === "significant" ? COLORS.series : "#FFFFFF")), line: { color: COLORS.series, width: 2 } },
              hovertemplate: `%{y}: %{x:+.3f} ${units}<extra></extra>`,
            },
          ]}
          layout={{
            font: { family: "Overpass, system-ui, sans-serif", size: 12, color: COLORS.ink },
            margin: { l: 220, r: 16, t: 28, b: 48 },
            height: 80 + items.length * 36,
            title: { text: `Trend per decade (${units}) · filled = significant after BH`, font: { size: 13 }, x: 0 },
            xaxis: { zeroline: true, zerolinecolor: COLORS.ink, gridcolor: COLORS.grid, title: { text: units } },
            yaxis: { automargin: true },
            showlegend: false,
          }}
        />
      ))}
    </section>
  );
}
