/**
 * Investigation plan: turns the workspace draft into a validated selection,
 * the list of planned analyses and sufficiency/coverage checks, plus the
 * reasons why "Start analysis" is still disabled. Pure and unit-tested.
 */
import { monthsBetween } from "@/src/analytics/series";
import { collectionOf, getCollection, getVariable, TOPICS } from "@/src/catalog";
import { type BBox, getRegion } from "@/src/catalog/regions";
import { groupByCollection, MAX_PROVIDER_READS, type Selection, SelectionSchema } from "@/src/jobs/selection";
import { fmtBBox, fmtMonth } from "@/src/lib/format";
import { windowForBBox } from "@/src/providers/grid";

export type LocationMode = "country" | "custom";

export interface LocationState {
  mode: LocationMode;
  regionId: string | null;
  customBBox: BBox | null;
}

export interface PlanDraft {
  question: string;
  variables: string[];
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
  question: string;
  period: { start: string; end: string; months: number; years: number; completeYears: number; label: string };
  location: { label: string; bbox: BBox; mode: LocationMode; detail: string } | null;
  variables: Array<{ key: string; name: string; product: string; source: string; units: string; coverage: string; domain: string }>;
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

/** Archive coverage shared by all selected variables (latest start, earliest end). */
export function sharedCoverage(variables: string[], now = new Date()): { start: string; end: string } {
  let start = "1980-01";
  let end = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  for (const key of variables) {
    const v = getVariable(key);
    if (!v) continue;
    const c = collectionOf(v).temporal;
    if (c.start > start) start = c.start;
    if (c.end && c.end < end) end = c.end;
  }
  return { start, end };
}

/** Topic period when every variable shares a topic, else the last 20 complete years inside coverage. */
export function suggestedPeriod(variables: string[], now = new Date()): { start: string; end: string } {
  const coverage = sharedCoverage(variables, now);
  const topic = TOPICS.find((t) => variables.length > 0 && variables.every((k) => t.variables.includes(k)));
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

export function buildPlan(draft: PlanDraft): Plan {
  const blockers: string[] = [];
  const checks: PlanCheck[] = [];
  const question = draft.question.trim();
  if (!question) blockers.push("Write the question this investigation answers (or use the suggested one).");

  const variables = draft.variables
    .map((key) => getVariable(key))
    .filter((v) => v !== undefined)
    .map((v) => {
      const c = collectionOf(v);
      return {
        key: v.key,
        name: v.name.en,
        product: `${c.shortName} v${c.version}`,
        source: c.provider,
        units: v.display.units,
        coverage: `${c.temporal.start} → ${c.temporal.end ?? "ongoing"}`,
        domain: v.domain,
      };
    });
  if (variables.length === 0) blockers.push("Choose at least one variable.");

  const location = activeLocation(draft.location);
  if (!location) blockers.push(draft.location.mode === "country" ? "Choose a country or territory, or switch to a custom area." : "Draw or type the custom area.");

  const validPeriod = YM.test(draft.start) && YM.test(draft.end) && draft.start <= draft.end;
  const months = validPeriod ? monthsBetween(draft.start, draft.end).length : 0;
  const complete = validPeriod ? completeYears(draft.start, draft.end) : 0;
  if (!validPeriod) blockers.push("The end month must not be before the start month.");
  else if (months < 12) blockers.push("Choose at least 12 months.");

  const coverage = sharedCoverage(draft.variables);
  if (variables.length > 0) checks.push({ level: "info", text: `Archive coverage for the selected variables: ${fmtMonth(coverage.start)} – ${fmtMonth(coverage.end)}.` });
  if (validPeriod && months >= 12) {
    if (complete < MIN_TREND_YEARS) checks.push({ level: "warn", text: `Only ${complete} complete calendar years: the annual trend needs at least ${MIN_TREND_YEARS}. Extend the period or use the suggested one.` });
    else checks.push({ level: "ok", text: `${complete} complete years: enough for the annual trend and seasonal trends.` });
    if (complete < 6) checks.push({ level: "warn", text: "Period comparison needs at least 6 complete years." });
  }

  const collections = groupByCollection({ variables: draft.variables });
  const reads = months * collections.size;
  if (reads > MAX_PROVIDER_READS) blockers.push(`This plan needs ${reads} live reads; the limit is ${MAX_PROVIDER_READS}. Shorten the period or use fewer products.`);
  if (location) {
    for (const name of collections.keys()) {
      const collection = getCollection(name);
      if (!collection) continue;
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
  if (variables.length > 1) additional.push(`Benjamini–Hochberg multiple-comparison correction across ${variables.length} trends`);

  return {
    ready: blockers.length === 0 && selection !== null,
    blockers,
    question,
    period: { start: draft.start, end: draft.end, months, years: Math.round((months / 12) * 10) / 10, completeYears: complete, label: validPeriod ? `${fmtMonth(draft.start)} → ${fmtMonth(draft.end)}` : "—" },
    location,
    variables,
    analyses: { primary: "Annual trend: OLS on complete-year means with Newey–West HAC uncertainty (1 lag); slope per decade with 95% CI", additional },
    checks,
    reads,
    estimatedSeconds: Math.round((reads * 1.3) / 6),
    selection,
  };
}
