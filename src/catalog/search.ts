/**
 * Catalog search over single words and phrases, in English (the platform is
 * English-only, D-35).
 * Matching is accent- and case-insensitive.
 */
import { TOPICS, VARIABLES } from "./index";
import type { CatalogVariable } from "./types";

export function normalizeText(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalizeText(text)
    .split(" ")
    .filter((t) => t.length > 1);
}

export interface SearchHit {
  variable: CatalogVariable;
  score: number;
  matched: string[];
}

export function searchCatalog(query: string, limit = 12): SearchHit[] {
  const q = normalizeText(query);
  if (!q) return [];
  const queryTokens = new Set(tokens(q));
  const hits: SearchHit[] = [];

  for (const variable of VARIABLES) {
    let score = 0;
    const matched = new Set<string>();
    const code = variable.dapName.replace(/^.*\//, "").toLowerCase();
    if (queryTokens.has(code)) {
      score += 10;
      matched.add(variable.dapName);
    }
    for (const phrase of variable.phrases.en) {
      const p = normalizeText(phrase);
      if (q.includes(p) || (q.length >= 4 && p.includes(q))) {
        score += 6;
        matched.add(phrase);
      }
    }
    for (const word of variable.words.en) {
      const w = normalizeText(word);
      if (queryTokens.has(w)) {
        score += 3;
        matched.add(word);
      } else if (w.length >= 4 && [...queryTokens].some((t) => t.length >= 4 && (w.startsWith(t) || t.startsWith(w)))) {
        score += 1;
        matched.add(word);
      }
    }
    if (q.length >= 4 && normalizeText(variable.name.en).includes(q)) {
      score += 4;
      matched.add(variable.name.en);
    }
    for (const topic of TOPICS) {
      if (!topic.variables.includes(variable.key)) continue;
      const topicTerms = [...topic.words.en, ...topic.phrases.en].map(normalizeText);
      if (topicTerms.some((t) => queryTokens.has(t) || q.includes(t))) {
        score += 2;
        matched.add(topic.title.en);
      }
    }
    // Naming a source ("era5", "noaa", "giovanni"…) prefers that source's variables.
    if (score > 0 && (SOURCE_WORDS[variable.source] ?? []).some((w) => queryTokens.has(w))) score += 5;
    // Giovanni entries are an alternative access path (cross-check), never the first suggestion.
    if (variable.source === "giovanni") score = Math.floor(score * 0.75);
    if (score > 0) hits.push({ variable, score, matched: [...matched] });
  }

  return hits.sort((a, b) => b.score - a.score || (SOURCE_RANK[a.variable.source] ?? 9) - (SOURCE_RANK[b.variable.source] ?? 9) || a.variable.key.localeCompare(b.variable.key)).slice(0, limit);
}

const SOURCE_WORDS: Record<string, string[]> = {
  merra2: ["merra", "merra-2", "merra2"],
  imerg: ["imerg", "gpm"],
  gldas: ["gldas", "noah"],
  seawifs: ["seawifs"],
  era5: ["era5", "copernicus", "ecmwf"],
  noaa: ["noaa", "ghcn", "gsom", "station", "stations"],
  giovanni: ["giovanni", "harmony"],
};

/** Tie-breaker between equally good matches: the long-standing NASA products first, cross-check paths last. */
const SOURCE_RANK: Record<string, number> = { merra2: 0, imerg: 1, gldas: 2, era5: 3, seawifs: 4, noaa: 5, giovanni: 6 };
