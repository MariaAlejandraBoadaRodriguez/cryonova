/**
 * Retrieval codes for saved investigations.
 *
 * Codes carry 60 random bits encoded in Crockford Base32 (no I, L, O, U), shown
 * as XXXX-XXXX-XXXX. Only a hash is stored; lookups normalize user input so
 * ambiguous characters (O/0, I/L/1) and separators do not matter.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";

export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 12;

export function generateRetrievalCode(random: (size: number) => Uint8Array = (size) => randomBytes(size)): string {
  const bytes = random(CODE_LENGTH);
  let raw = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    // 32 divides 256, so masking keeps the distribution uniform.
    raw += CODE_ALPHABET[(bytes[i] ?? 0) & 31];
  }
  return formatCode(raw);
}

export function formatCode(raw: string): string {
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

/** Returns the canonical 12-character code, or null when the input cannot be a code. */
export function normalizeCode(input: string): string | null {
  const cleaned = input
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (cleaned.length !== CODE_LENGTH) return null;
  for (const char of cleaned) {
    if (!CODE_ALPHABET.includes(char)) return null;
  }
  return cleaned;
}

/** Hash stored in the database. Uses HMAC when a pepper is configured. */
export function hashCode(normalized: string, pepper = process.env.CODE_PEPPER): string {
  if (pepper) return createHmac("sha256", pepper).update(normalized).digest("hex");
  return createHash("sha256").update(`cryonova:${normalized}`).digest("hex");
}

/** Non-reversible client key for throttling (never stores raw IP addresses). */
export function clientKey(ip: string, userAgent = ""): string {
  return createHash("sha256").update(`client:${ip}:${userAgent.slice(0, 80)}`).digest("hex").slice(0, 32);
}
