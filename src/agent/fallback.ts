/**
 * Rule-based planner used when the AI provider is unavailable, over quota or
 * fails. It reads the question deterministically (catalog phrases, gazetteer
 * names, years) and is clearly labeled as a rule-based proposal in the UI.
 */
import { findRegionsInText } from "@/src/catalog/regions";
import { searchCatalog } from "@/src/catalog/search";
import { lastCompleteYear, type Language, type RawProposal } from "./proposal";

const SPANISH = /[¿¡ñáéíóú]|\b(el|la|los|las|en|entre|desde|hasta|cambi[oó]|lluvia|temperatura|humedad|suelo|cu[aá]nto|c[oó]mo|qu[eé]|hay|regi[oó]n)\b/i;

export function detectLanguage(text: string): Language {
  return SPANISH.test(text) ? "es" : "en";
}

export function yearsInText(text: string): number[] {
  const max = lastCompleteYear() + 1;
  return [...text.matchAll(/\b(19[89]\d|20\d{2})\b/g)].map((m) => Number(m[1])).filter((y) => y >= 1980 && y <= max);
}

export function planWithRules(question: string): RawProposal {
  const language = detectLanguage(question);
  const region = findRegionsInText(question)[0];
  const hits = searchCatalog(question, 6).filter((h) => h.score >= 5);
  const top = hits.slice(0, 3);
  const years = yearsInText(question);
  const last = lastCompleteYear();
  let start = `${last - 19}-01`;
  let end = `${last}-12`;
  const since = /\b(since|desde)\s+(19[89]\d|20\d{2})\b/i.exec(question);
  if (years.length >= 2) {
    start = `${Math.min(...years)}-01`;
    end = `${Math.min(Math.max(...years), last)}-12`;
  } else if (since || years.length === 1) {
    start = `${since ? since[2] : years[0]}-01`;
  }
  const es = language === "es";
  return {
    language,
    variables: top.map((h) => ({
      key: h.variable.key,
      rationale: es ? `Coincide con: ${h.matched.slice(0, 3).join(", ")}.` : `Matches: ${h.matched.slice(0, 3).join(", ")}.`,
    })),
    regionId: region?.id ?? "",
    regionName: region ? (es ? region.names.es : region.names.en) : "",
    bbox: null,
    start,
    end,
    analysis: es
      ? "Serie mensual live, medias anuales de años completos y tendencia OLS con incertidumbre HAC (1 rezago)."
      : "Live monthly series, complete-year annual means and an OLS trend with HAC uncertainty (1 lag).",
    assumptions: [
      years.length === 0 && !since
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
