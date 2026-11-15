/**
 * Rule-based planner used when the AI provider is unavailable, over quota or
 * fails. It reads the question deterministically (catalog phrases, gazetteer
 * names, years) and is clearly labeled as a rule-based proposal in the UI.
 * Replies are always in English (D-35), whatever the language of the question.
 */
import { findRegionsInText, getRegion } from "@/src/catalog/regions";
import { searchCatalog } from "@/src/catalog/search";
import { validateBBox } from "@/src/providers/grid";
import { lastCompleteYear, type PlanContext, type RawProposal } from "./proposal";

export function yearsInText(text: string): number[] {
  const max = lastCompleteYear() + 1;
  return [...text.matchAll(/\b(19[89]\d|20\d{2})\b/g)].map((m) => Number(m[1])).filter((y) => y >= 1980 && y <= max);
}

const SINCE = /\bsince\s+(19[89]\d|20\d{2})\b/i;

/**
 * Reads the latest message first; a short clarification answer ("Colombia")
 * is completed with earlier user turns and then with the current setup.
 */
export function planWithRules(question: string, context: PlanContext = {}): RawProposal {
  const earlier = (context.history ?? []).filter((m) => m.role === "user").map((m) => m.text).join(" \n ");
  const region = findRegionsInText(question)[0] ?? (earlier ? findRegionsInText(earlier)[0] : undefined);
  let hits = searchCatalog(question, 6).filter((h) => h.score >= 5);
  if (hits.length === 0 && earlier) hits = searchCatalog(earlier, 6).filter((h) => h.score >= 5);
  const top = hits.slice(0, 3);
  let years = yearsInText(question);
  if (years.length === 0 && earlier) years = yearsInText(earlier);
  const current = context.current;
  const currentRegion = !region && current?.regionId ? getRegion(current.regionId) : undefined;
  const currentBox = !region && !currentRegion && current?.bbox && !validateBBox(current.bbox) ? current.bbox : null;
  const keepVariables = top.length === 0 ? (current?.variables ?? []).filter(Boolean).slice(0, 8) : [];
  const keepPeriod = years.length === 0 && !/\bsince\b/i.test(question) && current?.start && current?.end ? { start: current.start, end: current.end } : null;
  const last = lastCompleteYear();
  let start = `${last - 19}-01`;
  let end = `${last}-12`;
  const since = SINCE.exec(question) ?? (earlier ? SINCE.exec(earlier) : null);
  if (keepPeriod) {
    start = keepPeriod.start;
    end = keepPeriod.end;
  } else if (years.length >= 2) {
    start = `${Math.min(...years)}-01`;
    end = `${Math.min(Math.max(...years), last)}-12`;
  } else if (since || years.length === 1) {
    start = `${since ? since[1] : years[0]}-01`;
  }
  return {
    variables: [
      ...top.map((h) => ({ key: h.variable.key, rationale: `Matches: ${h.matched.slice(0, 3).join(", ")}.` })),
      ...keepVariables.map((key) => ({ key, rationale: "Kept from your current setup." })),
    ],
    regionId: (region ?? currentRegion)?.id ?? "",
    regionName: (region ?? currentRegion)?.names.en ?? "",
    bbox: currentBox,
    start,
    end,
    analysis: "Live monthly series, complete-year annual means and an OLS trend with HAC uncertainty (1 lag).",
    assumptions: [
      keepPeriod
        ? "The period from your current setup is kept."
        : years.length === 0 && !since
          ? "No period was given: the last 20 complete years are used."
          : "Period taken from the years mentioned in the question.",
    ],
    clarification: "",
  };
}
