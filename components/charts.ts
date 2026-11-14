/**
 * Plotly specifications built only from a run's structured result, so the
 * chart, tables, CSV, PDF and agent all read the same numbers.
 * Colors were validated with the dataviz palette checker (see docs/design).
 */
import type { VariableResult } from "@/src/jobs/types";
import { decimalsFor, fmtP, fmtSigned } from "@/src/lib/format";

export const COLORS = {
  series: "#11697A",
  seriesFaint: "rgba(17, 105, 122, 0.38)",
  trend: "#132B40",
  trendBand: "rgba(19, 43, 64, 0.12)",
  negative: "#2B6CB0",
  positive: "#C05621",
  grid: "#E3EAF1",
  axis: "#8FA5BA",
  ink: "#132B40",
  muted: "#4A5E70",
};

function pLabel(p: number): string {
  const text = fmtP(p);
  return text.startsWith("<") ? `p ${text}` : `p = ${text}`;
}

const FONT = { family: "Overpass, system-ui, sans-serif", size: 13, color: COLORS.ink };

function baseLayout(yTitle: string, source: string): Record<string, unknown> {
  return {
    font: FONT,
    paper_bgcolor: "#FFFFFF",
    plot_bgcolor: "#FFFFFF",
    margin: { l: 64, r: 16, t: 56, b: 64 },
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#FFFFFF", bordercolor: COLORS.axis, font: { ...FONT, size: 12 } },
    xaxis: { gridcolor: COLORS.grid, linecolor: COLORS.axis, zeroline: false, ticks: "outside", tickcolor: COLORS.axis },
    yaxis: { title: { text: yTitle, font: { ...FONT, size: 12 } }, gridcolor: COLORS.grid, linecolor: COLORS.axis, zeroline: false, ticks: "outside", tickcolor: COLORS.axis },
    legend: { orientation: "h", x: 0, y: 1.02, yanchor: "bottom", traceorder: "normal", font: { ...FONT, size: 12 } },
    annotations: [
      { text: source, xref: "paper", yref: "paper", x: 0, y: 0, yshift: -52, showarrow: false, xanchor: "left", yanchor: "top", font: { ...FONT, size: 11, color: COLORS.muted } },
    ],
  };
}

export function sourceLine(v: VariableResult, fetchedTo: string | null): string {
  const when = fetchedTo ? ` · fetched ${fetchedTo.slice(0, 10)}` : "";
  return `Source: NASA ${v.product} v${v.version} (${v.dapName.replace(/^.*\//, "")})${when} · cos-latitude weighted regional mean`;
}

export function seriesChart(v: VariableResult, fetchedTo: string | null) {
  const a = v.analysis;
  const decimals = Math.max(2, decimalsOf(v));
  const data: unknown[] = [
    {
      type: "scatter",
      mode: "lines",
      name: "Monthly mean",
      x: a.monthly.map((p) => `${p.month}-15`),
      y: a.monthly.map((p) => p.value),
      connectgaps: false,
      line: { color: COLORS.seriesFaint, width: 1 },
      hovertemplate: `%{y:.${decimals}f} ${a.units}<extra>Monthly</extra>`,
    },
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Annual mean (complete years)",
      x: a.annual.map((y) => `${y.year}-07-01`),
      y: a.annual.map((y) => y.mean),
      line: { color: COLORS.series, width: 2 },
      marker: { color: COLORS.series, size: 8, line: { color: "#FFFFFF", width: 2 } },
      hovertemplate: `%{y:.${decimals}f} ${a.units}<extra>Annual</extra>`,
    },
  ];
  const annotations: unknown[] = [];
  if (a.trend.status === "ok") {
    const t = a.trend;
    const years = a.annual.map((y) => y.year);
    const xMean = years.reduce((s, y) => s + y, 0) / years.length;
    const slope = t.slopePerDecade / 10;
    const intercept = t.fittedStart - slope * t.firstYear;
    const yMean = intercept + slope * xMean;
    const ends = [t.firstYear, t.lastYear];
    const line = (b: number) => ends.map((year) => yMean + b * (year - xMean));
    data.push(
      {
        type: "scatter",
        mode: "lines",
        name: "Lower trend bound",
        x: ends.map((y) => `${y}-07-01`),
        y: line(t.ci95PerDecade[0] / 10),
        line: { width: 0 },
        hoverinfo: "skip",
        showlegend: false,
      },
      {
        type: "scatter",
        mode: "lines",
        name: "95% interval of the trend (HAC)",
        x: ends.map((y) => `${y}-07-01`),
        y: line(t.ci95PerDecade[1] / 10),
        fill: "tonexty",
        fillcolor: COLORS.trendBand,
        line: { width: 0 },
        hoverinfo: "skip",
      },
      {
        type: "scatter",
        mode: "lines",
        name: "Linear trend (OLS)",
        x: ends.map((y) => `${y}-07-01`),
        y: line(slope),
        line: { color: COLORS.trend, width: 2, dash: "dash" },
        hovertemplate: `Trend %{y:.${decimals}f} ${a.units}<extra></extra>`,
      },
    );
    annotations.push({
      xref: "paper",
      yref: "paper",
      x: 0.01,
      y: 0.99,
      xanchor: "left",
      yanchor: "top",
      showarrow: false,
      align: "left",
      bgcolor: "rgba(255,255,255,0.92)",
      bordercolor: COLORS.axis,
      borderpad: 6,
      font: { ...FONT, size: 12 },
      text: `<b>${fmtSigned(t.slopePerDecade, decimals)} ${a.trendUnits}</b><br>95% CI ${fmtSigned(t.ci95PerDecade[0], decimals)} to ${fmtSigned(t.ci95PerDecade[1], decimals)} · ${pLabel(t.pValue)} · ${t.n} years`,
    });
  }
  const layout = baseLayout(`${v.name.en} (${a.units})`, sourceLine(v, fetchedTo));
  layout.annotations = [...(layout.annotations as unknown[]), ...annotations];
  return { data, layout };
}

export function anomalyChart(v: VariableResult, fetchedTo: string | null) {
  const a = v.analysis;
  const points = a.anomalies.filter((p) => p.anomaly !== null);
  const decimals = Math.max(2, decimalsOf(v));
  const data = [
    {
      type: "bar",
      name: "Monthly anomaly",
      x: points.map((p) => `${p.month}-15`),
      y: points.map((p) => p.anomaly),
      marker: { color: points.map((p) => ((p.anomaly ?? 0) >= 0 ? COLORS.positive : COLORS.negative)) },
      hovertemplate: `%{y:+.${decimals}f} ${a.units}<extra>vs. same-month mean</extra>`,
    },
  ];
  const layout = baseLayout(`Anomaly (${a.units})`, `${sourceLine(v, fetchedTo)} · baseline: mean of each calendar month in the selected period`);
  (layout.yaxis as Record<string, unknown>).zeroline = true;
  (layout.yaxis as Record<string, unknown>).zerolinecolor = COLORS.ink;
  layout.bargap = 0.15;
  layout.showlegend = false;
  return { data, layout };
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function seasonalCycleChart(v: VariableResult, fetchedTo: string | null) {
  const a = v.analysis;
  const decimals = Math.max(2, decimalsOf(v));
  const data = [
    {
      type: "scatter",
      mode: "lines+markers",
      name: "Mean of each calendar month",
      x: MONTH_LABELS,
      y: a.climatology.map((c) => c.mean),
      line: { color: COLORS.series, width: 2 },
      marker: { color: COLORS.series, size: 8, line: { color: "#FFFFFF", width: 2 } },
      hovertemplate: `%{y:.${decimals}f} ${a.units}<extra>%{x}</extra>`,
    },
  ];
  const layout = baseLayout(`${v.name.en} (${a.units})`, sourceLine(v, fetchedTo));
  layout.hovermode = "closest";
  layout.showlegend = false;
  return { data, layout };
}

export function decimalsOf(v: VariableResult): number {
  return decimalsFor(v.unitGroup);
}
