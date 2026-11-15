/**
 * Share-ready PDF report built from a run's structured result. Charts are
 * drawn as vector graphics (resolution independent, labels and units kept);
 * every number comes from the same result as the screen and the CSV.
 */
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { discover } from "@/src/analytics/discovery";
import type { Explanation } from "@/src/agent/explain";
import type { RunResult, VariableResult } from "@/src/jobs/types";
import { decimalsFor, fmt, fmtBBox, fmtMonth, fmtP, fmtSigned } from "@/src/lib/format";
import { seriesCaption } from "./captions";
import { adjustedPCell, changeVsVariability, trendWithInterval } from "./comparison";
import { coverageSentence, EVIDENCE_NAME, evidenceMeaning, evidenceOf, magnitudeSentence, NO_CLEAR_TREND_NOTE, qValuesFor, regionLabel, trendSentence } from "./narrative";

const PAGE: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const C = {
  deep: rgb(7 / 255, 23 / 255, 63 / 255),
  ink: rgb(19 / 255, 43 / 255, 64 / 255),
  teal: rgb(17 / 255, 105 / 255, 122 / 255),
  tealFaint: rgb(150 / 255, 190 / 255, 198 / 255),
  muted: rgb(74 / 255, 94 / 255, 112 / 255),
  grid: rgb(227 / 255, 234 / 255, 241 / 255),
  band: rgb(205 / 255, 213 / 255, 222 / 255),
  neon: rgb(234 / 255, 254 / 255, 7 / 255),
  white: rgb(1, 1, 1),
};

const REPLACEMENTS: Record<string, string> = { "−": "-", "–": "-", "—": "-", "≈": "~", "≤": "<=", "≥": ">=", "→": "->", "²": "2", "⁻": "-", "¹": "1", "³": "3", " ": " ", "✓": "OK", "·": "-" };

/** Standard PDF fonts only encode WinAnsi; map or replace anything else. */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = REPLACEMENTS[ch] ?? ch;
    for (const c of mapped) {
      const code = c.codePointAt(0) ?? 63;
      out += code === 9 || code === 10 || (code >= 32 && code <= 126) || (code >= 160 && code <= 255) || "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•˜™š›œžŸ".includes(c) ? c : "?";
    }
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of pdfSafe(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  readonly width = PAGE[0] - 2 * MARGIN;

  constructor(
    readonly doc: PDFDocument,
    readonly fonts: { regular: PDFFont; bold: PDFFont; mono: PDFFont },
  ) {
    this.newPage();
  }

  newPage() {
    this.page = this.doc.addPage(PAGE);
    this.y = PAGE[1] - MARGIN;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage();
  }

  text(text: string, options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; gap?: number; indent?: number } = {}) {
    const size = options.size ?? 10;
    const font = options.font ?? this.fonts.regular;
    const lines = wrap(text, font, size, this.width - (options.indent ?? 0));
    for (const line of lines) {
      this.ensure(size + 4);
      this.page.drawText(line, { x: MARGIN + (options.indent ?? 0), y: this.y - size, size, font, color: options.color ?? C.ink });
      this.y -= size * 1.35;
    }
    this.y -= options.gap ?? 4;
  }

  heading(text: string, size = 14) {
    this.ensure(size + 30);
    this.y -= 6;
    this.text(text, { size, font: this.fonts.bold, gap: 6 });
  }

  keyValues(rows: Array<[string, string]>) {
    for (const [k, v] of rows) {
      const lines = wrap(v, this.fonts.regular, 9.5, this.width - 120);
      this.ensure(lines.length * 13 + 2);
      this.page.drawText(pdfSafe(k), { x: MARGIN, y: this.y - 9.5, size: 9, font: this.fonts.bold, color: C.muted });
      for (const line of lines) {
        this.page.drawText(line, { x: MARGIN + 120, y: this.y - 9.5, size: 9.5, font: this.fonts.regular, color: C.ink });
        this.y -= 13;
      }
      this.y -= 2;
    }
    this.y -= 4;
  }
}

function niceTicks(min: number, max: number, count = 5): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => span / s <= count) ?? raw;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}

/** Vector chart: monthly series, annual means, OLS trend and its 95% band. */
function drawSeriesChart(w: Writer, v: VariableResult, source: string) {
  const a = v.analysis;
  const height = 210;
  w.ensure(height + 50);
  const page = w.page;
  const left = MARGIN + 46;
  const right = MARGIN + w.width - 8;
  const top = w.y - 8;
  const bottom = top - height;
  const monthly = a.monthly.map((p) => ({ x: Number(p.month.slice(0, 4)) + (Number(p.month.slice(5, 7)) - 0.5) / 12, y: p.value }));
  const xs = monthly.map((p) => p.x);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const values = [...monthly.map((p) => p.y).filter((y): y is number => y !== null), ...a.annual.map((y) => y.mean)];
  let band: Array<[number, number, number]> = [];
  const t = a.trend.status === "ok" ? a.trend : null;
  if (t) {
    const years = a.annual.map((y) => y.year);
    const xBar = years.reduce((s, y) => s + y, 0) / years.length;
    const slope = t.slopePerDecade / 10;
    const yBar = t.fittedStart - slope * t.firstYear + slope * xBar;
    band = [t.firstYear, t.lastYear].map((yr) => [yr + 0.5, yBar + (t.ci95PerDecade[0] / 10) * (yr - xBar), yBar + (t.ci95PerDecade[1] / 10) * (yr - xBar)]);
    values.push(...band.flatMap((b) => [b[1], b[2]]));
  }
  let yMin = Math.min(...values);
  let yMax = Math.max(...values);
  const pad = (yMax - yMin) * 0.06 || 1;
  yMin -= pad;
  yMax += pad;
  const sx = (x: number) => left + ((x - xMin) / (xMax - xMin || 1)) * (right - left);
  const sy = (y: number) => bottom + ((y - yMin) / (yMax - yMin || 1)) * (top - bottom);
  const d = decimalsFor(v.unitGroup);
  const font = w.fonts.regular;

  for (const tick of niceTicks(yMin, yMax)) {
    page.drawLine({ start: { x: left, y: sy(tick) }, end: { x: right, y: sy(tick) }, thickness: 0.5, color: C.grid });
    const label = pdfSafe(fmt(tick, Math.max(0, d - 1)));
    page.drawText(label, { x: left - 4 - font.widthOfTextAtSize(label, 7.5), y: sy(tick) - 2.5, size: 7.5, font, color: C.muted });
  }
  const yearStep = Math.max(1, Math.ceil((xMax - xMin) / 8));
  for (let year = Math.ceil(xMin); year <= xMax; year += yearStep) {
    page.drawLine({ start: { x: sx(year), y: bottom }, end: { x: sx(year), y: bottom - 3 }, thickness: 0.6, color: C.muted });
    page.drawText(String(year), { x: sx(year) - 9, y: bottom - 12, size: 7.5, font, color: C.muted });
  }
  page.drawLine({ start: { x: left, y: bottom }, end: { x: right, y: bottom }, thickness: 0.8, color: C.muted });
  page.drawLine({ start: { x: left, y: bottom }, end: { x: left, y: top }, thickness: 0.8, color: C.muted });
  page.drawText(pdfSafe(`${v.name.en} (${a.units})`), { x: MARGIN, y: top + 6, size: 8.5, font: w.fonts.bold, color: C.ink });

  if (band.length === 2) {
    const [b0, b1] = band as [[number, number, number], [number, number, number]];
    const path = `M ${sx(b0[0])} ${-sy(b0[1])} L ${sx(b1[0])} ${-sy(b1[1])} L ${sx(b1[0])} ${-sy(b1[2])} L ${sx(b0[0])} ${-sy(b0[2])} Z`;
    page.drawSvgPath(path, { x: 0, y: 0, color: C.band, opacity: 0.7, borderWidth: 0 });
  }
  for (let i = 1; i < monthly.length; i += 1) {
    const p0 = monthly[i - 1]!;
    const p1 = monthly[i]!;
    if (p0.y === null || p1.y === null) continue;
    page.drawLine({ start: { x: sx(p0.x), y: sy(p0.y) }, end: { x: sx(p1.x), y: sy(p1.y) }, thickness: 0.5, color: C.tealFaint });
  }
  const annual = a.annual.map((y) => ({ x: y.year + 0.5, y: y.mean }));
  for (let i = 1; i < annual.length; i += 1) {
    page.drawLine({ start: { x: sx(annual[i - 1]!.x), y: sy(annual[i - 1]!.y) }, end: { x: sx(annual[i]!.x), y: sy(annual[i]!.y) }, thickness: 1.4, color: C.teal });
  }
  for (const p of annual) page.drawCircle({ x: sx(p.x), y: sy(p.y), size: 2.4, color: C.teal, borderColor: C.white, borderWidth: 0.8 });
  if (t) {
    const slope = t.slopePerDecade / 10;
    const intercept = t.fittedStart - slope * t.firstYear;
    page.drawLine({ start: { x: sx(t.firstYear + 0.5), y: sy(intercept + slope * t.firstYear) }, end: { x: sx(t.lastYear + 0.5), y: sy(intercept + slope * t.lastYear) }, thickness: 1.3, color: C.ink, dashArray: [5, 3] });
    const note = pdfSafe(`${fmtSigned(t.slopePerDecade, d)} ${a.trendUnits}  (95% CI ${fmtSigned(t.ci95PerDecade[0], d)} to ${fmtSigned(t.ci95PerDecade[1], d)}; p ${fmtP(t.pValue)}; n = ${t.n})`);
    page.drawRectangle({ x: left + 6, y: top - 18, width: font.widthOfTextAtSize(note, 8) + 10, height: 14, color: C.white, opacity: 0.9, borderColor: C.muted, borderWidth: 0.5 });
    page.drawText(note, { x: left + 11, y: top - 14, size: 8, font: w.fonts.bold, color: C.ink });
  }
  const legend = "Thin line: monthly mean   Dots: annual mean (complete years)   Dashed: OLS trend   Band: 95% interval of the trend (HAC)";
  page.drawText(pdfSafe(legend), { x: MARGIN, y: bottom - 24, size: 7, font, color: C.muted });
  page.drawText(pdfSafe(source), { x: MARGIN, y: bottom - 34, size: 7, font, color: C.muted });
  w.y = bottom - 46;
}

export interface PdfOptions {
  code?: string | null;
  investigationId?: string | null;
  explanation?: Explanation | null;
  generatedAt?: Date;
}

export async function buildPdf(result: RunResult, options: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`Cryonova report - ${result.selection.question ?? regionLabel(result)}`));
  doc.setAuthor("Cryonova");
  doc.setSubject("Reproducible analysis of live NASA data");
  doc.setCreationDate(options.generatedAt ?? new Date());
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), mono: await doc.embedFont(StandardFonts.Courier) };
  const w = new Writer(doc, fonts);
  const region = regionLabel(result);
  const generated = (options.generatedAt ?? new Date()).toISOString().replace("T", " ").slice(0, 16);

  // Title band.
  w.page.drawRectangle({ x: 0, y: PAGE[1] - 92, width: PAGE[0], height: 92, color: C.deep });
  w.page.drawCircle({ x: MARGIN + 6, y: PAGE[1] - 40, size: 6, color: C.neon });
  w.page.drawText("Cryonova", { x: MARGIN + 20, y: PAGE[1] - 46, size: 20, font: fonts.bold, color: C.white });
  w.page.drawText(pdfSafe(`Investigation report - generated ${generated} UTC`), { x: MARGIN + 20, y: PAGE[1] - 64, size: 9, font: fonts.regular, color: C.white });
  w.y = PAGE[1] - 112;

  if (result.selection.question) w.text(`"${result.selection.question}"`, { size: 13, font: fonts.bold, gap: 8 });
  w.keyValues([
    ["Region", `${region} - ${fmtBBox(result.region.bbox)}`],
    ["Period", `${fmtMonth(result.selection.start)} to ${fmtMonth(result.selection.end)}`],
    ["Variables", result.variables.map((v) => `${v.name.en} (${v.product} v${v.version}, ${v.dapName.replace(/^.*\//, "")})`).join("; ")],
    ["Data fetched", `${result.sources[0]?.fetchedFrom?.replace("T", " ").slice(0, 19) ?? "-"} to ${result.sources[0]?.fetchedTo?.replace("T", " ").slice(0, 19) ?? "-"} UTC (live from ${[...new Set(result.sources.map((s) => s.servedBy ?? "NASA Earthdata"))].join(", ")})`],
    ["Run ID", result.runId],
    ...(options.investigationId ? ([["Investigation ID", options.investigationId]] as Array<[string, string]>) : []),
    ...(options.code ? ([["Retrieval code", `${options.code} (open read-only at Cryonova -> Open with code)`]] as Array<[string, string]>) : []),
  ]);

  w.heading("Findings");
  const qValues = qValuesFor(result);
  for (const v of result.variables) {
    w.text(trendSentence(v, region), { size: 10, gap: 2 });
    const magnitude = magnitudeSentence(v);
    if (magnitude) w.text(magnitude, { size: 9, color: C.muted, gap: 2 });
    const q = qValues.get(v.key) ?? null;
    const level = evidenceOf(v, q);
    w.text(`Evidence: ${EVIDENCE_NAME[level]}. ${evidenceMeaning(level, q !== null)} ${coverageSentence(v)}`, { size: 9, color: C.muted, gap: 8 });
  }

  for (const v of result.variables) {
    const source = result.sources.find((s) => s.collection === v.collection);
    w.heading(v.name.en, 12);
    drawSeriesChart(w, v, `Source: NASA ${v.product} v${v.version} (${v.dapName.replace(/^.*\//, "")}), fetched ${source?.fetchedTo?.slice(0, 10) ?? "-"}; cosine-latitude weighted regional mean of valid cells.`);
    w.text(seriesCaption(v), { size: 8.5, color: C.muted, gap: 6 });
    const st = v.analysis.seasonalTrends
      .map(({ season, trend }) => (trend.status === "ok" ? `${season} ${fmtSigned(trend.slopePerDecade, decimalsFor(v.unitGroup))} (p ${fmtP(trend.pValue)})` : `${season} insufficient`))
      .join("; ");
    w.text(`Seasonal trends (${v.analysis.trendUnits}): ${st}.`, { size: 9, gap: 2 });
    const pc = v.analysis.periodComparison;
    if (pc) w.text(`Period comparison: ${pc.firstPeriod.join("-")} mean ${fmt(pc.firstMean, decimalsFor(v.unitGroup))} vs ${pc.secondPeriod.join("-")} mean ${fmt(pc.secondMean, decimalsFor(v.unitGroup))} ${v.analysis.units}; difference ${fmtSigned(pc.difference, decimalsFor(v.unitGroup))} (Welch p ${fmtP(pc.pValue)}).`, { size: 9, gap: 8 });
  }

  if (result.variables.length > 1) {
    const discovery = discover(result);
    w.heading("Trend comparison across variables");
    w.text(`${discovery.evaluated} trends evaluated; ${discovery.correction}. Trend per decade with its 95% interval in parentheses; adjusted p is the Benjamini-Hochberg q.`, { size: 9, color: C.muted });
    for (const r of discovery.rows) {
      const trend = trendWithInterval(r);
      const magnitude = changeVsVariability(r);
      w.text(
        `${r.name} (${r.product}): ${trend ? `${trend.text}; adjusted p ${adjustedPCell(r).text} (raw p ${fmtP(r.pValue)})${magnitude ? `; change ${magnitude}` : ""}` : "no trend estimate"} - ${EVIDENCE_NAME[r.evidence]}`,
        { size: 9, gap: 1 },
      );
    }
    w.text(NO_CLEAR_TREND_NOTE, { size: 8.5, color: C.muted, gap: 2 });
    for (const e of discovery.excluded) w.text(`Excluded: ${e.name} - ${e.reason}`, { size: 9, color: C.muted, gap: 1 });
    w.y -= 6;
  }

  const e = options.explanation;
  if (e?.sections) {
    w.heading(e.source === "ai" ? "Interpretation (AI, figures verified against the results)" : "Interpretation (automatic)");
    const titles: Record<string, string> = { chart: "What the chart shows", pattern: "Pattern", change: "How much it changed", uncertainty: "Uncertainty", source: "Data source", limitations: "Limitations" };
    for (const [key, text] of Object.entries(e.sections)) {
      w.text(titles[key] ?? key, { size: 9.5, font: fonts.bold, gap: 1 });
      w.text(text, { size: 9.5, gap: 5 });
    }
    w.text(`Figures checked: ${e.verification.verified} of ${e.verification.checked}${e.verification.unverified.length ? `; unverified: ${e.verification.unverified.join(", ")}` : ""}.`, { size: 8.5, color: C.muted });
  }

  w.heading("Method, coverage and provenance");
  w.text(`${result.variables[0]?.analysis.method ?? ""}. Regional values are cosine-latitude weighted means of valid grid cells. A year enters the trend only with 12 valid months; at least 10 complete years are required.`, { size: 9 });
  for (const s of result.sources) {
    const where =
      s.kind === "stations"
        ? `${s.window.cells} of ${s.window.nativeCells} stations in the regional mean`
        : s.kind === "service"
          ? "area average computed by NASA Giovanni"
          : `${s.window.cells} cells per month at ${s.window.resolution}${s.window.stride > 1 ? `, every ${s.window.stride} cells` : ""}`;
    const refs = s.jobs?.length ? `provider job ${s.jobs.map((j) => j.jobRef).join(", ")}` : `granules ${s.firstGranule ?? "-"} to ${s.lastGranule ?? "-"}`;
    w.text(`${s.label ?? `${s.collection} v${s.version}`} (${s.conceptId}): ${s.monthsRead} of ${s.monthsRequested} months read, ${s.monthsFailed} failed, ${s.monthsMissing} unpublished; ${where}; ${refs}.`, { size: 9 });
  }
  for (const warning of result.warnings) w.text(`Note: ${warning}`, { size: 9, color: C.muted });

  w.heading("References");
  for (const s of result.sources) w.text(`${s.citation}${s.doi ? ` https://doi.org/${s.doi}` : ""}`, { size: 8.5 });
  w.text("Trend method reference: Newey, W. K. and West, K. D. (1987), A simple, positive semi-definite, heteroskedasticity and autocorrelation consistent covariance matrix, Econometrica 55(3), 703-708.", { size: 8.5 });

  const pages = doc.getPages();
  pages.forEach((page, i) => {
    page.drawText(pdfSafe(`Cryonova - run ${result.runId}${options.code ? ` - code ${options.code}` : ""} - page ${i + 1} of ${pages.length}`), { x: MARGIN, y: 24, size: 7.5, font: fonts.regular, color: C.muted });
  });
  return doc.save();
}
