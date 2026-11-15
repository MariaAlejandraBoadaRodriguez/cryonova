/**
 * Rule-based planner used when the AI provider is unavailable, over quota or
 * fails. It reads the question deterministically (catalog phrases, gazetteer
 * names, years) and is clearly labeled as a rule-based proposal in the UI.
 */
import { findRegionsInText, getRegion } from "@/src/catalog/regions";
import { searchCatalog } from "@/src/catalog/search";
import { validateBBox } from "@/src/providers/grid";
import { lastCompleteYear, type PlanContext, type RawProposal } from "./proposal";

import { detectLanguage } from "./language";

export { detectLanguage };

export function yearsInText(text: string): number[] {
  const max = lastCompleteYear() + 1;
  return [...text.matchAll(/\b(19[89]\d|20\d{2})\b/g)].map((m) => Number(m[1])).filter((y) => y >= 1980 && y <= max);
}

/**
 * Reads the latest message first; a short clarification answer ("Colombia")
 * is completed with earlier user turns and then with the current setup.
 */
export function planWithRules(question: string, context: PlanContext = {}): RawProposal {
  const earlier = (context.history ?? []).filter((m) => m.role === "user").map((m) => m.text).join(" \n ");
  const language = detectLanguage(`${question} ${earlier}`.trim());
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
  const keepPeriod = years.length === 0 && !/\b(since|desde)\b/i.test(question) && current?.start && current?.end ? { start: current.start, end: current.end } : null;
  const last = lastCompleteYear();
  let start = `${last - 19}-01`;
  let end = `${last}-12`;
  const since = /\b(since|desde)\s+(19[89]\d|20\d{2})\b/i.exec(question) ?? (earlier ? /\b(since|desde)\s+(19[89]\d|20\d{2})\b/i.exec(earlier) : null);
  if (keepPeriod) {
    start = keepPeriod.start;
    end = keepPeriod.end;
  } else if (years.length >= 2) {
    start = `${Math.min(...years)}-01`;
    end = `${Math.min(Math.max(...years), last)}-12`;
  } else if (since || years.length === 1) {
    start = `${since ? since[2] : years[0]}-01`;
  }
  const es = language === "es";
  return {
    language,
    variables: [
      ...top.map((h) => ({
        key: h.variable.key,
        rationale: es ? `Coincide con: ${h.matched.slice(0, 3).join(", ")}.` : `Matches: ${h.matched.slice(0, 3).join(", ")}.`,
      })),
      ...keepVariables.map((key) => ({ key, rationale: es ? "Se mantiene de tu configuración actual." : "Kept from your current setup." })),
    ],
    regionId: (region ?? currentRegion)?.id ?? "",
    regionName: region ? (es ? region.names.es : region.names.en) : currentRegion ? (es ? currentRegion.names.es : currentRegion.names.en) : "",
    bbox: currentBox,
    start,
    end,
    analysis: es
      ? "Serie mensual live, medias anuales de años completos y tendencia OLS con incertidumbre HAC (1 rezago)."
      : "Live monthly series, complete-year annual means and an OLS trend with HAC uncertainty (1 lag).",
    assumptions: [
      keepPeriod
        ? es
          ? "Se mantiene el periodo de tu configuración actual."
          : "The period from your current setup is kept."
        : years.length === 0 && !since
        ? es
          ? "No se indicó periodo: se usan los últimos 20 años completos."
          : "No period was given: the last 20 complete years are used."
        : es
          ? "Periodo tomado de los años mencionados en la pregunta."
          : "Period taken from the years mentioned in the question.",
    ],
    clarification: "",
  };
}
