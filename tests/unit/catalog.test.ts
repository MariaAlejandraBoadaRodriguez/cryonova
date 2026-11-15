import { describe, expect, it } from "vitest";
import { COLLECTIONS, getVariable, publicCatalog, TOPICS, VARIABLES } from "@/src/catalog";
import { DERIVED, derivePoints, getDerived } from "@/src/catalog/derived";
import { countryOptions, findRegionsInText, getRegion, REGIONS, searchRegions } from "@/src/catalog/regions";
import { normalizeText, searchCatalog } from "@/src/catalog/search";

describe("catalog", () => {
  // The original catalog of the approved prototype: id, exact fields and suggested years.
  const ORIGINAL: Array<[string, string, number]> = [
    ["air", "T2M", 20], ["rain", "PRECTOTCORR", 20], ["surface", "TS T2M", 20], ["heights", "T2M T10M", 20],
    ["variability", "Var_T2M Var_TS", 20], ["meanvar", "T2M TS Var_T2M Var_TS", 20], ["humid", "T2MWET T2M QV2M", 20],
    ["humidity", "QV2M QV10M", 20], ["dew", "T2M T2MDEW", 20], ["vapor", "TQV Q850 Q500 Q250", 20],
    ["clouds", "TQL TQI CLDTMP CLDPRS", 30], ["pressure", "PS SLP", 30], ["wind2", "U2M V2M", 30],
    ["windheights", "U10M V10M U50M V50M", 30], ["windupper", "U850 V850 U250 V250", 30], ["windmid", "U500 V500", 30],
    ["uppertemp", "T850 T500 T250", 30], ["thickness", "H1000 H850 H500 H250", 30], ["vertical", "OMEGA500 Q500", 30],
    ["boundary", "PS PBLTOP ZLCL", 30], ["displacement", "DISPH", 30], ["tropopause", "TROPPB TROPPT TROPPV TROPT TROPQ", 30],
    ["ozone", "TO3 TOX", 30],
  ];

  it("keeps the 22 original single-level topics and the rain case with their exact fields", () => {
    const original = TOPICS.filter((t) => t.origin === "original");
    expect(original.map((t) => t.id)).toEqual(ORIGINAL.map(([id]) => id));
    for (const [id, codes, years] of ORIGINAL) {
      const topic = TOPICS.find((t) => t.id === id)!;
      expect(topic.variables.map((k) => k.replace(/^.*\./, "")), id).toEqual(codes.split(" "));
      expect(topic.suggestedYears, id).toBe(years);
      const start = Number(topic.suggestedPeriod.start.slice(0, 4));
      const end = Number(topic.suggestedPeriod.end.slice(0, 4));
      expect(end - start + 1, id).toBe(years);
    }
    expect(original.filter((t) => t.collections.join() === "M2TMNXSLV")).toHaveLength(22);
  });

  it("has topics whose variables and derived series all exist", () => {
    expect(TOPICS.length).toBeGreaterThan(22);
    for (const topic of TOPICS) {
      for (const key of topic.variables) expect(getVariable(key), key).toBeDefined();
      for (const key of topic.derived) {
        const metric = getDerived(key);
        expect(metric, key).toBeDefined();
        for (const input of metric!.inputs) expect(topic.variables, `${topic.id} ${key}`).toContain(input);
      }
      expect(Number.isInteger(topic.fieldCount)).toBe(true);
    }
  });

  it("defines derived series from inputs of one collection", () => {
    for (const metric of DERIVED) {
      const collections = new Set(metric.inputs.map((k) => getVariable(k)?.collection));
      expect(collections.size, metric.key).toBe(1);
      expect(collections.has(undefined), metric.key).toBe(false);
    }
  });

  it("computes differences and vector magnitudes month by month", () => {
    const series = (values: Array<number | null>) => values.map((value, i) => ({ month: `2020-0${i + 1}`, value, validCells: value === null ? 0 : 10 - i, totalCells: 10 }));
    const diff = derivePoints(getDerived("derived.TS-T2M")!, [series([30, 31, null]), series([28, 30, 29])]);
    expect(diff.map((p) => p.value)).toEqual([2, 1, null]);
    expect(diff[2]!.validCells).toBe(0);
    const magnitude = derivePoints(getDerived("derived.WIND2M")!, [series([3]), series([4])]);
    expect(magnitude[0]!.value).toBeCloseTo(5, 12);
    const shear = derivePoints(getDerived("derived.WIND850-250")!, [series([1]), series([2]), series([4]), series([6])]);
    expect(shear[0]!.value).toBeCloseTo(5, 12);
  });

  it("keeps verified field counts per collection", () => {
    expect(COLLECTIONS.M2TMNXSLV?.fieldCount).toBe(94);
    expect(COLLECTIONS.M2TMNXFLX?.fieldCount).toBe(92);
    expect(COLLECTIONS.M2TMNXLND?.fieldCount).toBe(100);
    expect(COLLECTIONS.M2TMNXRAD?.fieldCount).toBe(72);
    expect(COLLECTIONS.M2TMNXAER?.fieldCount).toBe(100);
  });

  it("has unique keys and English words and phrases", () => {
    expect(new Set(VARIABLES.map((v) => v.key)).size).toBe(VARIABLES.length);
    for (const v of VARIABLES) {
      expect(v.words.en.length, v.key).toBeGreaterThan(0);
      expect(v.phrases.en.every((p) => p.includes(" ") || p.length > 2)).toBe(true);
    }
  });

  it("holds English text only (English-only platform, D-35)", () => {
    const shapes = [
      ...VARIABLES.flatMap((v) => [v.name, v.description, v.words, v.phrases]),
      ...TOPICS.flatMap((t) => [t.title, t.question, t.words, t.phrases]),
      ...DERIVED.flatMap((d) => [d.name, d.description]),
    ];
    for (const shape of shapes) expect(Object.keys(shape)).toEqual(["en"]);
  });

  it.each([
    ["air temperature", "merra2.T2M"],
    ["near-surface air temperature", "merra2.T2M"],
    ["T2M", "merra2.T2M"],
    // GLDAS (a dedicated land-surface model, added 2026-11-15) is the best match for soil moisture.
    ["soil moisture", "gldas.SoilMoi0_10cm_inst"],
    ["topsoil moisture", "gldas.SoilMoi0_10cm_inst"],
    ["surface soil wetness", "merra2.GWETTOP"],
    ["ocean chlorophyll", "seawifs.chlor_a"],
    ["chlorophyll", "seawifs.chlor_a"],
    ["weather stations temperature", "noaa.TAVG"],
    ["era5 temperature", "era5.t2m"],
    ["ozone layer", "merra2.TO3"],
    ["saharan dust", "merra2.DUEXTTAU"],
  ])("finds %s", (query, key) => {
    expect(searchCatalog(query)[0]?.variable.key).toBe(key);
  });

  it("returns several precipitation sources for rain", () => {
    const keys = searchCatalog("rain").map((h) => h.variable.key);
    expect(keys).toContain("merra2.PRECTOTCORR");
    expect(keys).toContain("imerg.precipitation");
    expect(searchCatalog("")).toEqual([]);
  });

  it("normalizes accents and case", () => {
    expect(normalizeText("  Türkiye  TOTAL ")).toBe("turkiye total");
  });

  it("exposes a serializable public catalog", () => {
    const pub = publicCatalog();
    expect(pub.variables.find((v) => v.key === "merra2.T2M")).toMatchObject({ product: "M2TMNXSLV", version: "5.12.4", fieldCount: 94, displayUnits: "°C" });
    expect(JSON.parse(JSON.stringify(pub)).topics).toHaveLength(TOPICS.length);
  });
});

describe("regions", () => {
  it("resolves countries by English name, alias or ISO code", () => {
    expect(searchRegions("Colombia")[0]?.region.iso2).toBe("CO");
    expect(searchRegions("Brazil")[0]?.region.iso2).toBe("BR");
    expect(searchRegions("United States")[0]?.region.iso2).toBe("US");
    expect(searchRegions("USA")[0]?.region.iso2).toBe("US");
    expect(searchRegions("x")).toEqual([]);
  });

  it("shows English names only", () => {
    for (const region of REGIONS) expect(Object.keys(region.names), region.id).toEqual(["en"]);
    const names = countryOptions().map((r) => r.names.en);
    expect(names).toContain("Spain");
    expect(names).not.toContain("España");
  });

  it("finds the region mentioned in a question", () => {
    const found = findRegionsInText("Did near-surface air temperature in Colombia change between 2005 and 2025?");
    expect(found[0]?.iso2).toBe("CO");
    expect(findRegionsInText("Is it raining more in the Amazon basin?")[0]?.id).toBe("region:amazon");
  });

  it("keeps antimeridian-crossing boxes with west > east", () => {
    const fiji = searchRegions("Fiji")[0]!.region.bbox;
    expect(fiji.west).toBeGreaterThan(fiji.east);
    expect(getRegion("region:global")?.bbox).toEqual({ west: -180, south: -90, east: 180, north: 90 });
  });
});
