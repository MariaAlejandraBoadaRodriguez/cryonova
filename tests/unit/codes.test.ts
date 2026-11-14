import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, clientKey, formatCode, generateRetrievalCode, hashCode, normalizeCode } from "@/src/lib/codes";

describe("retrieval codes", () => {
  it("generates formatted Crockford Base32 codes", () => {
    const code = generateRetrievalCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(normalizeCode(code)).toBe(code.replace(/-/g, ""));
  });

  it("maps every random byte onto the 32-symbol alphabet", () => {
    const code = generateRetrievalCode(() => new Uint8Array([0, 31, 32, 63, 255, 1, 2, 3, 4, 5, 6, 7]));
    expect(code).toBe(`${CODE_ALPHABET[0]}${CODE_ALPHABET[31]}${CODE_ALPHABET[0]}${CODE_ALPHABET[31]}-${CODE_ALPHABET[31]}123-4567`);
  });

  it("does not repeat across many draws", () => {
    const codes = new Set(Array.from({ length: 5000 }, () => generateRetrievalCode()));
    expect(codes.size).toBe(5000);
  });

  it("normalizes user input and rejects impossible codes", () => {
    expect(normalizeCode(" abcd-efgh-jk0o ")).toBe("ABCDEFGHJK00");
    expect(normalizeCode("ILIL-1111-2222")).toBe("111111112222");
    expect(normalizeCode("ABCD-EFGH-JKMU")).toBeNull();
    expect(normalizeCode("short")).toBeNull();
    expect(formatCode("ABCDEFGHJKMN")).toBe("ABCD-EFGH-JKMN");
  });

  it("hashes deterministically, with an optional pepper", () => {
    expect(hashCode("ABCDEFGHJKMN", "")).toBe(hashCode("ABCDEFGHJKMN", ""));
    expect(hashCode("ABCDEFGHJKMN", "")).not.toBe(hashCode("ABCDEFGHJKMN", "pepper"));
    expect(hashCode("ABCDEFGHJKMN", "")).toHaveLength(64);
    expect(clientKey("203.0.113.9", "agent")).toHaveLength(32);
    expect(clientKey("203.0.113.9")).not.toBe(clientKey("203.0.113.10"));
  });
});
