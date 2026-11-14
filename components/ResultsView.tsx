"use client";

/**
 * Results of one run: headline finding, annotated chart, extra analyses,
 * accessible tables, coverage and provenance. Everything is rendered from the
 * run's structured result (live or reopened from Neon).
 */
import { useMemo } from "react";
import { getRegion } from "@/src/catalog/regions";
import type { RunResult, VariableResult } from "@/src/jobs/types";
import { fmt, fmtBBox, fmtBytes, fmtDuration, fmtMonth, fmtP, fmtSigned, fmtUtc } from "@/src/lib/format";
import { coverageSentence, EVIDENCE_LABEL, evidenceOf, magnitudeSentence, regionLabel, trendSentence } from "@/src/reports/narrative";
import { anomalyChart, decimalsOf, seasonalCycleChart, seriesChart } from "./charts";
import { Plot } from "./Plot";

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function EvidenceBadge({ v }: { v: VariableResult }) {
  const level = evidenceOf(v);
  const strong = level === "significant";
  return (
    <span className={strong ? "badge badge-strong" : "badge badge-neutral"}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        {strong ? <circle cx="5" cy="5" r="5" fill="#EAFE07" /> : <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="2" />}
      </svg>
      {EVIDENCE_LABEL[level]}
    </span>
  );
}

function VariableCard({ v, result, index }: { v: VariableResult; result: RunResult; index: number }) {
  const a = v.analysis;
  const d = decimalsOf(v);
  const source = result.sources.find((s) => s.collection === v.collection);
  const fetchedTo = source?.fetchedTo ?? null;
  const series = useMemo(() => seriesChart(v, fetchedTo), [v, fetchedTo]);
  const anomalies = useMemo(() => anomalyChart(v, fetchedTo), [v, fetchedTo]);
  const cycle = useMemo(() => seasonalCycleChart(v, fetchedTo), [v, fetchedTo]);
  const region = regionLabel(result);
  const trend = a.trend.status === "ok" ? a.trend : null;
  const magnitude = magnitudeSentence(v);

  return (
    <article className="card" aria-labelledby={`var-${index}`} data-testid={`variable-${v.key}`}>
      <p className="step-label">
        {v.product} v{v.version} · {v.dapName.replace(/^.*\//, "")}
      </p>
      <h3 id={`var-${index}`}>
        {v.name.en} · {region}
      </h3>
      <div className="headline stack">
        {trend ? (
          <>
            <div className="value" data-testid="trend-value">
              {fmtSigned(trend.slopePerDecade, d)} {a.trendUnits}
            </div>
            <div>
              95% CI {fmtSigned(trend.ci95PerDecade[0], d)} to {fmtSigned(trend.ci95PerDecade[1], d)} · p {fmtP(trend.pValue)} · {trend.n} complete years ({trend.firstYear}–{trend.lastYear})
            </div>
          </>
        ) : (
          <div className="value">No trend estimate</div>
        )}
        <EvidenceBadge v={v} />
        <p style={{ margin: 0 }}>{trendSentence(v, region)}</p>
        {magnitude && <p className="muted" style={{ margin: 0 }}>{magnitude}</p>}
      </div>

      <div style={{ marginTop: 16 }}>
        <Plot
          {...series}
          testId="series-chart"
          ariaLabel={`Monthly and annual ${v.name.en} in ${region} with linear trend. ${trendSentence(v, region)} Values are listed in the tables below.`}
        />
      </div>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="k">Period mean</div>
          <div className="v">
            {fmt(a.stats.mean, d)} {a.units}
          </div>
        </div>
        <div className="stat">
          <div className="k">Lowest month</div>
          <div className="v">{a.stats.min ? `${fmt(a.stats.min.value, d)} (${fmtMonth(a.stats.min.month)})` : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">Highest month</div>
          <div className="v">{a.stats.max ? `${fmt(a.stats.max.value, d)} (${fmtMonth(a.stats.max.month)})` : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">Valid months</div>
          <div className="v">
            {a.coverage.monthsValid}/{a.coverage.requestedMonths}
          </div>
        </div>
        <div className="stat">
          <div className="k">Valid cells</div>
          <div className="v">{a.coverage.meanValidCellFraction === null ? "—" : `${fmt(a.coverage.meanValidCellFraction * 100, 1)}% of ${a.coverage.cellsPerMonth}`}</div>
        </div>
      </div>
      <p className="field-help">{coverageSentence(v)}</p>

      <details>
        <summary>Seasonal cycle</summary>
        <Plot {...cycle} ariaLabel={`Average ${v.name.en} for each calendar month in ${region}.`} />
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">Mean of each calendar month</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">
                  Mean ({a.units})
                </th>
                <th scope="col" className="num">
                  Years
                </th>
              </tr>
            </thead>
            <tbody>
              {a.climatology.map((c) => (
                <tr key={c.month}>
                  <th scope="row">{MONTH_NAMES[c.month - 1]}</th>
                  <td className="num">{fmt(c.mean, d)}</td>
                  <td className="num">{c.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary>Monthly anomalies</summary>
        <Plot {...anomalies} ariaLabel={`Monthly anomalies of ${v.name.en} relative to each calendar month's mean. Warm bars are above, blue bars below.`} />
        <p className="field-help">
          Longest run of positive anomalies:{" "}
          {a.streaks.longestPositiveAnomalyMonths
            ? `${a.streaks.longestPositiveAnomalyMonths.length} months (${fmtMonth(a.streaks.longestPositiveAnomalyMonths.start)} – ${fmtMonth(a.streaks.longestPositiveAnomalyMonths.end)})`
            : "none"}
          ; current run: {a.streaks.currentPositiveAnomalyMonths} months.
        </p>
      </details>

      <details>
        <summary>Seasonal trends, ranking and period comparison</summary>
        <div className="table-wrap">
          <table className="data">
            <caption className="visually-hidden">Trend per season</caption>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col" className="num">
                  Trend ({a.trendUnits})
                </th>
                <th scope="col" className="num">
                  95% CI
                </th>
                <th scope="col" className="num">
                  p
                </th>
                <th scope="col" className="num">
                  Years
                </th>
              </tr>
            </thead>
            <tbody>
              {a.seasonalTrends.map(({ season, trend: st }) => (
                <tr key={season}>
                  <th scope="row">{season}</th>
                  {st.status === "ok" ? (
                    <>
                      <td className="num">{fmtSigned(st.slopePerDecade, d)}</td>
                      <td className="num">
                        {fmtSigned(st.ci95PerDecade[0], d)} to {fmtSigned(st.ci95PerDecade[1], d)}
                      </td>
                      <td className="num">{fmtP(st.pValue)}</td>
                      <td className="num">{st.n}</td>
                    </>
                  ) : (
                    <td colSpan={4}>{st.reason}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a.periodComparison && (
          <p>
            Mean {a.periodComparison.firstPeriod.join("–")}: <strong>{fmt(a.periodComparison.firstMean, d)}</strong> {a.units}; mean {a.periodComparison.secondPeriod.join("–")}:{" "}
            <strong>{fmt(a.periodComparison.secondMean, d)}</strong> {a.units}; difference {fmtSigned(a.periodComparison.difference, d)} {a.units} (Welch t-test p {fmtP(a.periodComparison.pValue)}).
          </p>
        )}
        {a.ranking.length > 0 && (
          <p>
            Highest years: {a.ranking.slice(0, 3).map((r) => `${r.year} (${fmt(r.mean, d)})`).join(", ")}. Lowest years:{" "}
            {a.ranking.slice(-3).reverse().map((r) => `${r.year} (${fmt(r.mean, d)})`).join(", ")}.
            {a.streaks.longestAboveMeanYears ? ` Longest run of years above the period mean: ${a.streaks.longestAboveMeanYears.length} (${a.streaks.longestAboveMeanYears.start}–${a.streaks.longestAboveMeanYears.end}).` : ""}
          </p>
        )}
      </details>

      <details>
        <summary>Values table (annual and monthly)</summary>
        <div className="table-wrap" style={{ maxHeight: 360 }}>
          <table className="data">
            <caption className="visually-hidden">Annual means used for the trend</caption>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  Annual mean ({a.units})
                </th>
                <th scope="col" className="num">
                  Valid months
                </th>
              </tr>
            </thead>
            <tbody>
              {a.annual.map((y) => (
                <tr key={y.year}>
                  <th scope="row">{y.year}</th>
                  <td className="num">{fmt(y.mean, d)}</td>
                  <td className="num">{y.months}</td>
                </tr>
              ))}
              {a.excludedYears.map((y) => (
                <tr key={`x${y.year}`}>
                  <th scope="row">{y.year}</th>
                  <td colSpan={2}>Excluded: {y.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap" style={{ maxHeight: 360, marginTop: 10 }}>
          <table className="data">
            <caption className="visually-hidden">Monthly regional means</caption>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">
                  Value ({a.units})
                </th>
                <th scope="col" className="num">
                  Valid cells
                </th>
              </tr>
            </thead>
            <tbody>
              {a.monthly.map((p) => (
                <tr key={p.month}>
                  <th scope="row">{p.month}</th>
                  <td className="num">{p.value === null ? "missing" : fmt(p.value, d + 1)}</td>
                  <td className="num">
                    {p.validCells}/{p.totalCells}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

export function ResultsView({ result }: { result: RunResult }) {
  const regionKnown = result.selection.region.regionId ? getRegion(result.selection.region.regionId) : undefined;
  return (
    <div className="stack" data-testid="results">
      {result.warnings.length > 0 && (
        <div className="alert alert-warn" role="status">
          <span aria-hidden="true">⚠</span>
          <div>
            <strong>Notes on coverage</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {result.variables.map((v, i) => (
        <VariableCard key={v.key} v={v} result={result} index={i} />
      ))}

      <section className="card" aria-labelledby="provenance-title" data-testid="provenance">
        <h3 id="provenance-title">Sources, method and provenance</h3>
        <dl className="kv">
          <dt>Run</dt>
          <dd className="mono">{result.runId}</dd>
          <dt>Region</dt>
          <dd>
            {regionKnown?.names.en ?? result.region.name ?? "Custom box"} · {fmtBBox(result.region.bbox)}
          </dd>
          <dt>Period</dt>
          <dd>
            {fmtMonth(result.selection.start)} – {fmtMonth(result.selection.end)}
          </dd>
          <dt>Method</dt>
          <dd>{result.variables[0]?.analysis.method}. Regional values are cosine-latitude weighted means of valid grid cells; years need 12 valid months.</dd>
          <dt>Timings</dt>
          <dd>
            discovery {fmtDuration(result.timings.discoveryMs)} · reads {fmtDuration(result.timings.readWallMs)} wall ({result.timings.concurrency} workers) · analysis {fmtDuration(result.timings.analysisMs)} · total{" "}
            {fmtDuration(result.timings.totalMs)} · {result.timings.invocations} invocation(s)
          </dd>
          <dt>Completed</dt>
          <dd>{fmtUtc(result.completedAt)}</dd>
        </dl>
        {result.sources.map((s) => (
          <details key={s.collection} open>
            <summary>
              {s.collection} v{s.version} — {s.provider}
            </summary>
            <dl className="kv">
              <dt>Product</dt>
              <dd>{s.title}</dd>
              <dt>CMR collection</dt>
              <dd>
                <a href={`https://cmr.earthdata.nasa.gov/search/concepts/${s.conceptId}.html`} target="_blank" rel="noreferrer">
                  {s.conceptId}
                </a>
                {s.doi && (
                  <>
                    {" "}
                    · DOI{" "}
                    <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer">
                      {s.doi}
                    </a>
                  </>
                )}
              </dd>
              <dt>Data received</dt>
              <dd>
                {s.monthsRead} of {s.monthsRequested} months read · {s.monthsFailed} failed · {s.monthsMissing} not published · {fmtBytes(s.bytes)}
              </dd>
              <dt>Granules</dt>
              <dd className="mono">
                {s.firstGranule ?? "—"} → {s.lastGranule ?? "—"}
              </dd>
              <dt>Fetched</dt>
              <dd>
                {fmtUtc(s.fetchedFrom)} → {fmtUtc(s.fetchedTo)} (median read {fmtDuration(s.readMs.median)}, p95 {fmtDuration(s.readMs.p95)})
              </dd>
              <dt>Grid window</dt>
              <dd>
                {s.window.cells} cells per month at {s.window.resolution}
                {s.window.stride > 1 ? `, every ${s.window.stride} cells` : ""} · lat index {s.window.lat.start}–{s.window.lat.stop} · lon pieces{" "}
                {s.window.lon.map((p) => `${p.start}–${p.stop}`).join(" + ")}
              </dd>
              <dt>Access</dt>
              <dd>{s.access}</dd>
              <dt>Example request</dt>
              <dd className="mono">{s.exampleRequest ?? "—"}</dd>
              <dt>Citation</dt>
              <dd>{s.citation}</dd>
            </dl>
          </details>
        ))}
      </section>
    </div>
  );
}
