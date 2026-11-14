/**
 * Checks that every number cited in an AI explanation matches a value in the
 * structured result it was given (within the rounding the text shows).
 * Handles decimal commas (Spanish), thousands separators, percentages,
 * signed values and ranges.
 */

export interface CitedNumber {
  raw: string;
  value: number;
}

export interface Verification {
  checked: number;
  verified: number;
  unverified: string[];
}

// Always-acceptable framing numbers (confidence level, thresholds, calendar).
const FRAMING = new Set([0, 1, 2, 3, 4, 5, 10, 12, 95, 100, 0.05]);

export function collectNumbers(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) {
    out.push(value);
    if (Math.abs(value) <= 1) out.push(value * 100);
  } else if (typeof value === "string") {
    for (const m of value.matchAll(/-?\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  } else if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectNumbers(item, out);
  }
  return out;
}

/** Numbers as written in prose. Each match may have several readings (comma as decimal or thousands). */
export function extractNumbers(text: string): Array<{ raw: string; readings: number[]; decimals: number[] }> {
  const out: Array<{ raw: string; readings: number[]; decimals: number[] }> = [];
  const pattern = /(?<![\w.,])[+\-−]?\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?(?![\d])|(?<![\w.,])[+\-−]?\d+(?:[.,]\d+)?(?![\d])/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const unsigned = raw.replace(/^[+\-−]/, "");
    const readings: number[] = [];
    const decimals: number[] = [];
    const add = (s: string) => {
      const n = Number(s);
      if (Number.isFinite(n)) {
        readings.push(n);
        decimals.push(s.includes(".") ? s.split(".")[1]!.length : 0);
      }
    };
    if (/^\d+$/.test(unsigned)) add(unsigned);
    else {
      add(unsigned.replace(/,/g, "")); // English thousands / decimal point
      add(unsigned.replace(/\./g, "").replace(",", ".")); // Spanish decimal comma
      if (/^\d+,\d+$/.test(unsigned)) add(unsigned.replace(",", "."));
    }
    out.push({ raw, readings, decimals });
  }
  return out;
}

export function verifyNumbers(text: string, facts: unknown): Verification {
  const allowed = collectNumbers(facts).map(Math.abs);
  const cited = extractNumbers(text);
  const unverified: string[] = [];
  let checked = 0;
  for (const c of cited) {
    const ok = c.readings.some((value, i) => {
      if (FRAMING.has(value)) return true;
      const tolerance = 0.5 * 10 ** -(c.decimals[i] ?? 0) + 1e-9;
      return allowed.some((a) => Math.abs(a - value) <= tolerance);
    });
    checked += 1;
    if (!ok) unverified.push(c.raw);
  }
  return { checked, verified: checked - unverified.length, unverified: [...new Set(unverified)] };
}
