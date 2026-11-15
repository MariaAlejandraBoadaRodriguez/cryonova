/**
 * Proposal contract shared by the AI planner and the rule-based fallback.
 * Raw proposals are always normalized here: variables must exist in the
 * catalog, regions resolve through the gazetteer, periods are clamped to
 * declared coverage and the provider-read limit, and the result is validated
 * with the same schema the run executor uses.
 */
import { collectionOf, getVariable } from "@/src/catalog";
import { type BBox, getRegion } from "@/src/catalog/regions";
import { monthsBetween } from "@/src/analytics/series";
import { groupByCollection, MAX_PROVIDER_READS, type Selection, SelectionSchema } from "@/src/jobs/selection";
import { validateBBox } from "@/src/providers/grid";

export type Language = "en" | "es";

export interface RawProposal {
  language: Language;
  variables: Array<{ key: string; rationale: string }>;
  regionId: string;
  regionName: string;
  bbox: BBox | null;
  start: string;
  end: string;
  analysis: string;
  assumptions: string[];
  clarification: string;
  /** The investigation question restated by the planner (optional; the asked text is used otherwise). */
  question?: string;
}

/**
 * Optional context sent with a question (backward compatible: older clients
 * send only the question). "current" is the workspace setup as the user left
 * it, manual edits included; "history" is the earlier conversation.
 */
export interface PlanContext {
  current?: { variables: string[]; start?: string; end?: string; regionId?: string; bbox?: BBox };
  history?: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface ToolTrace {
  tool: string;
  input: unknown;
  summary: string;
}

export interface Proposal {
  source: "ai" | "rules";
  language: Language;
  /** Ready to run when region and variables are present. */
  ready: boolean;
  selection: Partial<Selection> & { variables: string[]; start: string; end: string };
  rationale: Array<{ key: string; text: string }>;
  analysis: string;
  assumptions: string[];
  clarification: string | null;
  notes: string[];
  trace: ToolTrace[];
  ai?: { model: string; costUsd: number; latencyMs: number; inputTokens: number; outputTokens: number };
  aiStatus?: string;
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export function lastCompleteYear(now = new Date()): number {
  return now.getUTCFullYear() - 1;
}

export function finalizeProposal(raw: RawProposal, source: Proposal["source"], question: string): Proposal {
  const notes: string[] = [];
  const known = raw.variables.filter((v) => getVariable(v.key));
  const dropped = raw.variables.filter((v) => !getVariable(v.key)).map((v) => v.key);
  if (dropped.length > 0) notes.push(`Ignored variables that are not in the verified catalog: ${dropped.join(", ")}.`);
  const unique = known.filter((v, i) => known.findIndex((w) => w.key === v.key) === i).slice(0, 8);

  let bbox: BBox | null = null;
  let regionName = raw.regionName.trim();
  let regionId: string | undefined;
  const region = raw.regionId ? getRegion(raw.regionId) : undefined;
  if (region) {
    bbox = region.bbox;
    regionId = region.id;
    regionName = region.names.en;
  } else if (raw.bbox && !validateBBox(raw.bbox)) {
    bbox = raw.bbox;
  } else if (raw.regionId || raw.bbox) {
    notes.push("The proposed region could not be resolved; choose it on the map or by name.");
  }

  // Period: valid format, ordered, inside declared coverage, under the read limit.
  const fallbackEnd = `${lastCompleteYear()}-12`;
  let start = YM.test(raw.start) ? raw.start : `${lastCompleteYear() - 19}-01`;
  let end = YM.test(raw.end) ? raw.end : fallbackEnd;
  if (end > fallbackEnd) {
    end = fallbackEnd;
    notes.push(`The end was moved to ${fallbackEnd}, the last complete year.`);
  }
  if (start > end) [start, end] = [end, start];
  for (const v of unique) {
    const coverage = collectionOf(getVariable(v.key)!).temporal;
    if (start < coverage.start) {
      notes.push(`${v.key} starts in ${coverage.start}; the start was adjusted.`);
      start = coverage.start;
    }
    if (coverage.end && end > coverage.end) {
      notes.push(`${v.key} is published until ${coverage.end}; the end was adjusted.`);
      end = coverage.end;
    }
  }
  const collections = groupByCollection({ variables: unique.map((v) => v.key) }).size || 1;
  while (monthsBetween(start, end).length * collections > MAX_PROVIDER_READS) {
    const year = Number(start.slice(0, 4)) + 1;
    start = `${year}${start.slice(4)}`;
    if (!notes.some((n) => n.startsWith("The period was shortened"))) notes.push("The period was shortened to stay within the live query limit.");
  }

  const selection = {
    question: (raw.question?.trim() || question.trim()).slice(0, 600) || undefined,
    region: bbox ? { bbox, name: regionName || undefined, regionId, source: "agent" as const } : undefined,
    start,
    end,
    variables: unique.map((v) => v.key),
    mode: "guided" as const,
  };
  const ready = Boolean(bbox) && unique.length > 0 && SelectionSchema.safeParse(selection).success;
  let clarification = raw.clarification.trim() || null;
  if (!bbox && !clarification) clarification = raw.language === "es" ? "¿Qué región quieres analizar?" : "Which region should be analyzed?";
  if (unique.length === 0 && !clarification) clarification = raw.language === "es" ? "¿Qué variable te interesa?" : "Which variable are you interested in?";

  return {
    source,
    language: raw.language,
    ready,
    selection,
    rationale: unique.map((v) => ({ key: v.key, text: v.rationale })),
    analysis: raw.analysis,
    assumptions: raw.assumptions.slice(0, 6),
    clarification,
    notes,
    trace: [],
  };
}
