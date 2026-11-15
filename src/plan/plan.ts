/**
 * Investigation plan: turns the workspace draft into a validated selection,
 * the list of planned analyses and sufficiency/coverage checks, plus the
 * reasons why "Start analysis" is still disabled. Pure and unit-tested.
 * The question is optional: without one, a working title generated from the
 * selection is used, and the user can edit it.
 */
import { monthsBetween } from "@/src/analytics/series";
import { accessOf, collectionOf, getCollection, getVariable, productLabel, TOPICS } from "@/src/catalog";
import { getDerived } from "@/src/catalog/derived";
import { type BBox, getRegion } from "@/src/catalog/regions";
import { groupByCollection, MAX_PROVIDER_READS, MAX_VARIABLES, type Selection, SelectionSchema } from "@/src/jobs/selection";
import { fmtBBox, fmtMonth } from "@/src/lib/format";
import { windowForBBox } from "@/src/providers/grid";
import { era5GridStep, minStationMonths, NOAA_MAX_CANDIDATES as MAX_CANDIDATES, NOAA_MAX_STATIONS, OBDAAC_FILE_FALLBACK_MONTHS } from "@/src/providers/limits";

export type LocationMode = "country" | "custom";

export interface LocationState {
  mode: LocationMode;
  regionId: string | null;
  customBBox: BBox | null;
}

export interface PlanDraft {
  question: string;
  variables: string[];
  /** Derived series (differences, wind-vector magnitudes) computed from the selected variables. */
  derived: string[];
  start: string;
  end: string;
  location: LocationState;
}

export interface PlanCheck {
  level: "ok" | "warn" | "info";
  text: string;
}

export interface Plan {
  ready: boolean;
  blockers: string[];
  /** The typed question, or the working title when none was typed. */
  question: string;
  /** True when `question` is the generated working title (nothing typed yet). */
  questionIsWorkingTitle: boolean;
  period: { start: string; end: string; months: number; years: number; completeYears: number; label: string };
  location: { label: string; bbox: BBox; mode: LocationMode; detail: string } | null;
  variables: Array<{ key: string; name: string; product: string; source: string; units: string; coverage: string; domain: string }>;
  derived: Array<{ key: string; name: string; formula: string; units: string }>;
  analyses: { primary: string; additional: string[] };
  checks: PlanCheck[];
  reads: number;
  estimatedSeconds: number;
  selection: Selection | null;
}

export const MIN_TREND_YEARS = 10;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export function lastCompleteYear(now = new Date()): number {
  return now.getUTCFullYear() - 1;
}

export function activeLocation(location: LocationState): Plan["location"] {
  if (location.mode === "country") {
    const region = location.regionId ? getRegion(location.regionId) : undefined;
    if (!region) return null;
    return { label: region.names.en, bbox: region.bbox, mode: "country", detail: fmtBBox(region.bbox) };
  }
  if (!location.customBBox) return null;
  return { label: "Custom area", bbox: location.customBBox, mode: "custom", detail: fmtBBox(location.customBBox) };
}

/**
 * Archive coverage shared by all selected variables (latest start, earliest end).
 * With no variable selected it is the MERRA-2 span (1980 to now).
 */
export function sharedCoverage(variables: string[], now = new Date()): { start: string; end: string } {
  const known = variables.map((key) => getVariable(key)).filter((v) => v !== undefined);
  let start = known.length > 0 ? "0000-01" : "1980-01";
  let end = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (const v of known) {
    const c = collectionOf(v).temporal;
    if (c.start > start) start = c.start;
    if (c.end && c.end < end) end = c.end;
  }
  return { start, end };
}

/**
 * Years offered by the period selects: the archive coverage of the selected
 * variables, widened to include the current start and end so the selects always
 * show the value the user chose (an out-of-coverage year is flagged, never rewritten).
 */
export function periodYearRange(variables: string[], start: string, end: string, now = new Date()): { min: number; max: number } {
  const coverage = sharedCoverage(variables, now);
  const years = [start, end].filter((ym) => YM.test(ym)).map((ym) => Number(ym.slice(0, 4)));
  return { min: Math.min(Number(coverage.start.slice(0, 4)), ...years), max: Math.max(Number(coverage.end.slice(0, 4)), ...years) };
}

/** Adds exactly one catalog variable. Unknown keys, duplicates and keys beyond MAX_VARIABLES leave the list as it is. */
export function addVariable(variables: string[], key: string): string[] {
  if (!getVariable(key) || variables.includes(key) || variables.length >= MAX_VARIABLES) return variables;
  return [...variables, key];
}

/** The chosen derived series whose inputs are all still selected. Nothing is ever added. */
export function keepDerived(variables: string[], derived: string[]): string[] {
  return derived.filter((key) => getDerived(key)?.inputs.every((k) => variables.includes(k)));
}

/** "Near-surface air temperature (2 m)" → "near-surface air temperature (2 m)"; names starting with an acronym keep their case. */
function inSentence(name: string): string {
  return /^[A-Z][a-z]/.test(name) ? name[0]!.toLowerCase() + name.slice(1) : name;
}

/**
 * Editable working title generated from the selection, used as the plan's
 * question when none was typed, e.g. "Trend in near-surface air temperature (2 m), Colombia, 2000–2020".
 */
export function workingTitle(draft: Pick<PlanDraft, "variables" | "start" | "end" | "location">): string {
  const names = draft.variables
    .map((key) => getVariable(key))
    .filter((v) => v !== undefined)
    .map((v) => inSentence(v.name.en));
  const subject = names.length === 0 ? "the selected variables" : names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and ${names.length - 1} more variables`;
  const location = activeLocation(draft.location);
  const place = location ? (location.mode === "custom" ? "custom area" : location.label) : null;
  const first = draft.start.slice(0, 4);
  const last = draft.end.slice(0, 4);
  const years = YM.test(draft.start) && YM.test(draft.end) && draft.start <= draft.end ? (first === last ? first : `${first}–${last}`) : null;
  return [`Trend in ${subject}`, place, years].filter(Boolean).join(", ");
}

/** The topic matching the variables exactly, else the smallest topic that contains all of them. */
export function topicFor(variables: string[]): (typeof TOPICS)[number] | undefined {
  if (variables.length === 0) return undefined;
  const exact = TOPICS.find((t) => t.variables.length === variables.length && variables.every((k) => t.variables.includes(k)));
  if (exact) return exact;
  return TOPICS.filter((t) => variables.every((k) => t.variables.includes(k))).sort((a, b) => a.variables.length - b.variables.length)[0];
}

/** Topic period when every variable shares a topic, else the last 20 complete years inside coverage. */
export function suggestedPeriod(variables: string[], now = new Date()): { start: string; end: string } {
  const coverage = sharedCoverage(variables, now);
  const topic = topicFor(variables);
  let end = `${lastCompleteYear(now)}-12`;
  if (coverage.end < end) end = `${Number(coverage.end.slice(0, 4)) - (coverage.end.endsWith("-12") ? 0 : 1)}-12`;
  let start = topic ? topic.suggestedPeriod.start : `${Number(end.slice(0, 4)) - 19}-01`;
  if (topic && topic.suggestedPeriod.end < end) end = topic.suggestedPeriod.end;
  if (start < coverage.start) start = coverage.start;
  return { start, end };
}

export function suggestQuestion(draft: PlanDraft): string | null {
  const location = activeLocation(draft.location);
  const first = draft.variables[0] ? getVariable(draft.variables[0]) : undefined;
  if (!location || !first || !YM.test(draft.start) || !YM.test(draft.end)) return null;
  const subject = draft.variables.length > 1 ? `${first.name.en.toLowerCase()} and ${draft.variables.length - 1} related variable(s)` : first.name.en.toLowerCase();
  return `Did ${subject} in ${location.mode === "custom" ? "the selected area" : location.label} change between ${draft.start.slice(0, 4)} and ${draft.end.slice(0, 4)}?`;
}

const INTERROGATIVE = /^(¿|did|does|do|has|have|is|are|was|were|how|what|which|when|where|why|can|could|will|ha|han|hay|es|son|está|están|cómo|qué|cuál|cuánto|cuánta|dónde|por qué|cuándo)\b/i;

/** True for text that reads as a research question rather than a short reply ("Colombia", "use rain instead"). */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  return t.length >= 12 && (t.endsWith("?") || t.startsWith("¿") || INTERROGATIVE.test(t));
}

function completeYears(start: string, end: string): number {
  const startYear = Number(start.slice(0, 4)) + (start.endsWith("-01") ? 0 : 1);
  const endYear = Number(end.slice(0, 4)) - (end.endsWith("-12") ? 0 : 1);
  return Math.max(0, endYear - startYear + 1);
}

/** What each kind of provider access means for this plan: queued jobs, station data, OB.DAAC limits. */
export function accessChecks(collectionNames: string[], months: number, bbox: BBox | null): PlanCheck[] {
  const checks: PlanCheck[] = [];
  for (const name of collectionNames) {
    const collection = getCollection(name);
    if (!collection) continue;
    const access = accessOf(collection);
    if (access === "obdaac") {
      checks.push({ level: "info", text: `${name}: ocean cells only, ${fmtMonth(collection.temporal.start)} – ${fmtMonth(collection.temporal.end ?? collection.temporal.start)}; 2008-02, 2008-03 and 2009-05 were never produced.` });
      if (months > OBDAAC_FILE_FALLBACK_MONTHS) {
        checks.push({
          level: "warn",
          text: `${name}: ${months} months is too long for the full-file fallback. Months are read as small OPeNDAP subsets from OB.DAAC; if OB.DAAC rate-limits the server, at most ${OBDAAC_FILE_FALLBACK_MONTHS} months per run can be read from whole monthly files (about 10.7 MB each), and the rest would be reported as failed. Choose ${OBDAAC_FILE_FALLBACK_MONTHS} months or fewer to be sure every month can be read.`,
        });
      }
    } else if (access === "cds") {
      checks.push({ level: "info", text: `${name}: requested from Copernicus CDS as one queued job. CDS queues take from minutes to hours; the dashboard shows the job and keeps checking while it is open (nothing waits on a server request).` });
      if (bbox) {
        const step = era5GridStep(bbox, months, collectionNames.length);
        if (step > 0.25) checks.push({ level: "warn", text: `${name}: large request, ERA5 is requested on a ${step.toFixed(2)}° grid instead of 0.25° to keep the result small.` });
      }
    } else if (access === "harmony") {
      checks.push({ level: "info", text: `${name}: NASA Giovanni computes the area average (one NASA Harmony job, usually ready within a minute).` });
    } else if (access === "noaa-cdo") {
      checks.push({ level: "info", text: `${name}: point data from weather stations. Up to ${MAX_CANDIDATES} stations with the best record inside the area are read; the ${NOAA_MAX_STATIONS} with the most months (at least ${minStationMonths(months)} months each) form the regional mean, and every station is shown on the map.` });
    }
  }
  return checks;
}

export function buildPlan(draft: PlanDraft): Plan {
  const blockers: string[] = [];
  const checks: PlanCheck[] = [];
  // The question is optional: without one, the working title stands in for it (and stays editable).
  const typed = draft.question.trim();
  const question = typed || workingTitle(draft);

  const variables = draft.variables
    .map((key) => getVariable(key))
    .filter((v) => v !== undefined)
    .map((v) => {
      const c = collectionOf(v);
      return {
        key: v.key,
        name: v.name.en,
        product: productLabel(c),
        source: c.provider,
        units: v.display.units,
        coverage: `${c.temporal.start} → ${c.temporal.end ?? "ongoing"}`,
        domain: v.domain,
      };
    });
  if (variables.length === 0) blockers.push("Choose at least one variable.");

  const derived = draft.derived
    .map((key) => getDerived(key))
    .filter((d) => d !== undefined && d.inputs.every((k) => draft.variables.includes(k)))
    .map((d) => ({ key: d!.key, name: d!.name.en, formula: d!.formula, units: d!.display.units }));

  const location = activeLocation(draft.location);
  if (!location) blockers.push(draft.location.mode === "country" ? "Choose a country or territory, or switch to a custom area." : "Draw or type the custom area.");

  const validPeriod = YM.test(draft.start) && YM.test(draft.end) && draft.start <= draft.end;
  const months = validPeriod ? monthsBetween(draft.start, draft.end).length : 0;
  const complete = validPeriod ? completeYears(draft.start, draft.end) : 0;
  // Hard rules only disable Start analysis; the dates the user chose are never rewritten.
  if (!validPeriod) blockers.push("The end month must not be before the start month.");
  else if (months < 12) blockers.push("Choose at least 12 months.");

  const coverage = sharedCoverage(draft.variables);
  const ongoing = draft.variables.every((k) => {
    const v = getVariable(k);
    return !v || collectionOf(v).temporal.end === null;
  });
  if (variables.length > 0) {
    checks.push({ level: "info", text: `Archive coverage for the selected variables: ${fmtMonth(coverage.start)} – ${ongoing ? "ongoing (latest month the provider has published)" : fmtMonth(coverage.end)}.` });
    // Outside the archive is flagged, never corrected: the user's dates stay as chosen.
    if (validPeriod && draft.start < coverage.start) checks.push({ level: "warn", text: `The start (${fmtMonth(draft.start)}) is before the archive coverage of the selected variables, which begins in ${fmtMonth(coverage.start)}.` });
    if (validPeriod && draft.end > coverage.end) checks.push({ level: "warn", text: `The end (${fmtMonth(draft.end)}) is after the archive coverage of the selected variables, which ends in ${fmtMonth(coverage.end)}.` });
  }
  if (validPeriod && months >= 12) {
    if (complete < MIN_TREND_YEARS) checks.push({ level: "warn", text: `Fewer than ${MIN_TREND_YEARS} complete years (${complete}): the trend will be uncertain. Extend the period or use the suggested one.` });
    else checks.push({ level: "ok", text: `${complete} complete years: enough for the annual trend and seasonal trends.` });
    if (complete < 6) checks.push({ level: "warn", text: "Period comparison needs at least 6 complete years." });
  }

  // A question that names years outside the period usually means one of them was edited and not the other.
  if (typed && validPeriod) {
    const firstYear = Number(draft.start.slice(0, 4));
    const lastYear = Number(draft.end.slice(0, 4));
    const outside = [...new Set([...question.matchAll(/\b(19[89]\d|20\d{2})\b/g)].map((m) => Number(m[1])))].filter((y) => y < firstYear || y > lastYear);
    if (outside.length > 0) {
      checks.push({ level: "warn", text: `The question mentions ${outside.join(" and ")}, outside the selected period (${firstYear}–${lastYear}). Update the question or the period so they match.` });
    }
  }

  const collections = groupByCollection({ variables: draft.variables });
  const reads = months * collections.size;
  if (reads > MAX_PROVIDER_READS) blockers.push(`This plan needs ${reads} live reads; the limit is ${MAX_PROVIDER_READS}. Shorten the period or use fewer products.`);
  checks.push(...accessChecks([...collections.keys()], months, location?.bbox ?? null));
  if (location) {
    for (const name of collections.keys()) {
      const collection = getCollection(name);
      if (!collection || accessOf(collection) !== "opendap" && accessOf(collection) !== "obdaac") continue;
      const window = windowForBBox(collection.grid, location.bbox);
      if (window.stride > 1) checks.push({ level: "warn", text: `${name}: large area, sampled every ${window.stride} grid cells (${window.cells} cells per month).` });
      if (window.snapped) checks.push({ level: "warn", text: `${name}: the area is smaller than one grid cell; the nearest cell is used.` });
    }
    if (location.bbox.west > location.bbox.east) checks.push({ level: "info", text: "The area crosses the 180° meridian; it is read in two pieces." });
  }
  if (variables.some((v) => v.domain === "land")) checks.push({ level: "info", text: "Land-only variables use land cells only; ocean cells are excluded from their means." });
  if (reads > 0) checks.push({ level: "info", text: `${reads} live provider reads, about ${Math.max(5, Math.round((reads * 1.3) / 6))} s with 6 parallel requests.` });

  let selection: Selection | null = null;
  if (blockers.length === 0 && location) {
    const parsed = SelectionSchema.safeParse({
      question,
      region: { bbox: location.bbox, name: location.mode === "country" ? location.label : undefined, regionId: location.mode === "country" ? (draft.location.regionId ?? undefined) : undefined, source: location.mode === "country" ? "named" : "drawn" },
      start: draft.start,
      end: draft.end,
      variables: draft.variables,
      ...(derived.length > 0 ? { derived: derived.map((d) => d.key) } : {}),
      mode: draft.variables.length > 2 ? "discovery" : "manual",
    });
    if (parsed.success) selection = parsed.data;
    else blockers.push(...new Set(parsed.error.issues.map((i) => i.message)));
  }

  const additional = [
    "Monthly regional series (cos-latitude weighted mean of valid cells)",
    "Seasonal cycle (mean of each calendar month)",
    "Monthly anomalies against each month's mean",
    "Seasonal trends (DJF, MAM, JJA, SON)",
    "Period comparison: first vs second half (Welch t-test)",
    "Annual ranking and runs of positive anomalies",
  ];
  for (const d of derived) additional.push(`Derived series ${d.formula} (${d.name.toLowerCase()}), from the regional monthly means`);
  const trends = variables.length + derived.length;
  if (trends > 1) additional.push(`Benjamini–Hochberg multiple-comparison correction across ${trends} trends`);

  return {
    ready: blockers.length === 0 && selection !== null,
    blockers,
    question,
    questionIsWorkingTitle: !typed,
    period: { start: draft.start, end: draft.end, months, years: Math.round((months / 12) * 10) / 10, completeYears: complete, label: validPeriod ? `${fmtMonth(draft.start)} → ${fmtMonth(draft.end)}` : "—" },
    location,
    variables,
    derived,
    analyses: { primary: "Annual trend: OLS on complete-year means with Newey–West HAC uncertainty (1 lag); slope per decade with 95% CI", additional },
    checks,
    reads,
    estimatedSeconds: Math.round((reads * 1.3) / 6),
    selection,
  };
}
