/**
 * Reading stored explanations (client-safe: types only from the server modules).
 *
 * Cryonova answers in English only since 2026-11-15 (D-35). Runs and saved
 * investigations from before that date may hold summaries in another language,
 * either as `summary` with its `language` or keyed by language under
 * `summaries` ({ en, es }). Those entries are kept as stored and never shown:
 * readers take the English summary when there is one; otherwise a live run asks
 * for a fresh English explanation and a saved investigation says none was saved.
 */
import type { Explanation } from "./explain";

export interface StoredExplanations {
  /** The latest summary. New ones are always English. */
  summary?: Explanation;
  /** Legacy (before D-35): summaries keyed by language. Only `en` is read. */
  summaries?: Record<string, Explanation | undefined>;
  /** Follow-up answers, oldest first, shown as they were saved. */
  followUps?: Explanation[];
}

/** True for an English explanation; entries saved without a language count as English. */
export function isEnglish(explanation: { language?: unknown } | null | undefined): boolean {
  if (!explanation) return false;
  return explanation.language === undefined || explanation.language === "en";
}

/** The stored English summary (newest first), or null when none is stored. */
export function englishSummary(stored: StoredExplanations | null | undefined): Explanation | null {
  for (const candidate of [stored?.summary, stored?.summaries?.en]) {
    if (candidate && isEnglish(candidate)) return candidate;
  }
  return null;
}
