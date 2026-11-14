import { describe, expect, it } from "vitest";
import { COLLECTIONS, getVariable, publicCatalog, TOPICS, VARIABLES } from "@/src/catalog";
import { findRegionsInText, getRegion, searchRegions } from "@/src/catalog/regions";
import { normalizeText, searchCatalog } from "@/src/catalog/search";

describe("catalog", () => {
  it("has 22 topics whose variables all exist", () => {
    expect(TOPICS).toHaveLength(22);
    for (const topic of TOPICS) {
      for (const key of topic.variables) expect(getVariable(key), key).toBeDefined();
      expect(Number.isInteger(topic.fieldCount)).toBe(true);
    }
  });

  it("keeps verified field counts per collection", () => {
    expect(COLLECTIONS.M2TMNXSLV?.fieldCount).toBe(94);
    expect(COLLECTIONS.M2TMNXFLX?.fieldCount).toBe(92);
    expect(COLLECTIONS.M2TMNXLND?.fieldCount).toBe(100);
    expect(COLLECTIONS.M2TMNXRAD?.fieldCount).toBe(72);
    expect(COLLECTIONS.M2TMNXAER?.fieldCount).toBe(100);
  });

  it("has unique keys and separate per-language words and phrases", () => {
    expect(new Set(VARIABLES.map((v) => v.key)).size).toBe(VARIABLES.length);
    for (const v of VARIABLES) {
      expect(v.words.en.length + v.words.es.length).toBeGreaterThan(0);
      expect(v.phrases.en.every((p) => p.includes(" ") || p.length > 2)).toBe(true);
    }
  });

  it.each([
    ["temperatura del aire", "merra2.T2M"],
    ["near-surface air temperature", "merra2.T2M"],
    ["T2M", "merra2.T2M"],
    ["soil moisture", "merra2.GWETTOP"],
    ["humedad del suelo", "merra2.GWETTOP"],
    ["ozone layer", "merra2.TO3"],
    ["polvo del sahara", "merra2.DUEXTTAU"],
  ])("finds %s", (query, key) => {
    expect(searchCatalog(query)[0]?.variable.key).toBe(key);
  });

  it("returns several precipitation sources for rain", () => {
    const keys = searchCatalog("lluvia").map((h) => h.variable.key);
    expect(keys).toContain("merra2.PRECTOTCORR");
    expect(keys).toContain("imerg.precipitation");
    expect(searchCatalog("")).toEqual([]);
  });

  it("normalizes accents and case", () => {
    expect(normalizeText("  Precipitación  TOTAL ")).toBe("precipitacion total");
  });

  it("exposes a serializable public catalog", () => {
    const pub = publicCatalog();
    expect(pub.variables.find((v) => v.key === "merra2.T2M")).toMatchObject({ product: "M2TMNXSLV", version: "5.12.4", fieldCount: 94, displayUnits: "°C" });
    expect(JSON.parse(JSON.stringify(pub)).topics).toHaveLength(22);
  });
});

describe("regions", () => {
  it("resolves countries in English and Spanish", () => {
    expect(searchRegions("Colombia")[0]?.region.iso2).toBe("CO");
    expect(searchRegions("Brasil")[0]?.region.iso2).toBe("BR");
    expect(searchRegions("Estados Unidos")[0]?.region.iso2).toBe("US");
    expect(searchRegions("x")).toEqual([]);
  });

  it("finds the region mentioned in a question", () => {
    const found = findRegionsInText("Did near-surface air temperature in Colombia change between 2005 and 2025?");
    expect(found[0]?.iso2).toBe("CO");
    expect(findRegionsInText("¿Llueve más en la cuenca amazónica?")[0]?.id).toBe("region:amazon");
  });

  it("keeps antimeridian-crossing boxes with west > east", () => {
    const fiji = searchRegions("Fiji")[0]!.region.bbox;
    expect(fiji.west).toBeGreaterThan(fiji.east);
    expect(getRegion("region:global")?.bbox).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });
});
