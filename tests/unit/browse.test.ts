import { describe, expect, it } from "vitest";
import { COLLECTIONS, VARIABLES } from "@/src/catalog";
import { type CatalogGroup, catalogGroups, catalogSources, countEntries, coverageLabel, entryMatches, fieldCode, filterCatalog, groupLabel } from "@/src/catalog/browse";
import { DERIVED } from "@/src/catalog/derived";

const GROUPS = catalogGroups();
const keysOf = (groups: CatalogGroup[]) => groups.flatMap((g) => g.entries.map((e) => e.key));
const CONNECTORS = ["merra2", "imerg", "gldas", "seawifs", "era5", "noaa", "giovanni"];

describe("catalog page model", () => {
  it("lists every variable and derived series exactly once", () => {
    const keys = keysOf(GROUPS);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...keys].sort()).toEqual([...VARIABLES.map((v) => v.key), ...DERIVED.map((d) => d.key)].sort());
    expect(countEntries(GROUPS)).toEqual({ variables: VARIABLES.length, derived: DERIVED.length });
  });

  it("groups by collection in catalog order, with each derived group right after its inputs' collection", () => {
    const collections = Object.keys(COLLECTIONS).filter((c) => VARIABLES.some((v) => v.collection === c));
    expect(GROUPS.filter((g) => !g.id.startsWith("derived-")).map((g) => g.id)).toEqual(collections);
    expect(GROUPS.slice(0, 6).map((g) => g.label)).toEqual(["MERRA-2 SLV", "Derived from MERRA-2 SLV", "MERRA-2 FLX", "MERRA-2 LND", "MERRA-2 RAD", "MERRA-2 AER"]);
    expect(GROUPS.map((g) => g.label)).toEqual(expect.arrayContaining(["GPM IMERG", "GLDAS Noah", "SeaWiFS", "ERA5", "NOAA stations", "NASA Giovanni · GLDAS_NOAH025_M"]));
    expect(GROUPS[0]!.title).toBe("Single-Level Diagnostics");
    for (const g of GROUPS) {
      expect(CONNECTORS, g.id).toContain(g.source);
      expect(COLLECTIONS[g.collection]?.source, g.id).toBe(g.source);
    }
  });

  it("gives each entry its code, units and collection facts", () => {
    const entry = (key: string) => GROUPS.flatMap((g) => g.entries).find((e) => e.key === key)!;
    const t2m = entry("merra2.T2M");
    expect(t2m).toMatchObject({ kind: "variable", name: "Near-surface air temperature (2 m)", code: "T2M", displayUnits: "°C", providerUnits: "K" });
    expect(t2m.facts).toMatchObject({ product: "M2TMNXSLV v5.12.4", resolution: "0.5° lat × 0.625° lon", frequency: "Monthly", coverage: "Jan 1980 – present", geometry: "grid", area: "Global" });
    expect(entry("imerg.precipitation")).toMatchObject({ code: "precipitation", facts: { coverage: "Jan 1998 – Sep 2025" } });
    expect(entry("noaa.PRCP").facts).toMatchObject({ geometry: "stations", area: "Weather stations inside the area", access: "NOAA NCEI · NOAA Climate Data Online web services" });
    expect(entry("gldas.SoilMoi0_10cm_inst").facts.area).toBe("Global, land cells only");
    const era5 = VARIABLES.find((v) => v.source === "era5" && v.requestName)!;
    expect(entry(era5.key)).toMatchObject({ code: era5.dapName, requestName: era5.requestName });
    const derived = entry("derived.TS-T2M");
    expect(derived).toMatchObject({ kind: "derived", formula: "TS − T2M", inputs: [{ key: "merra2.TS", code: "TS" }, { key: "merra2.T2M", code: "T2M" }] });
  });

  it("names every source once, with counts that add up", () => {
    const sources = catalogSources(GROUPS);
    expect(sources.map((s) => s.id)).toEqual(CONNECTORS);
    expect(sources.reduce((sum, s) => sum + s.count, 0)).toBe(VARIABLES.length + DERIVED.length);
    expect(sources[0]).toMatchObject({ id: "merra2", label: "NASA MERRA-2", count: VARIABLES.filter((v) => v.source === "merra2").length + DERIVED.length });
  });

  it("searches names, codes, descriptions and synonyms, ignoring case and accents", () => {
    expect(keysOf(filterCatalog(GROUPS, { query: "t2mdew", source: "" }))).toEqual(["merra2.T2MDEW", "derived.T2M-T2MDEW"]);
    expect(keysOf(filterCatalog(GROUPS, { query: "  DEW   Póint ", source: "" }))).toEqual(expect.arrayContaining(["merra2.T2MDEW", "derived.T2M-T2MDEW"]));
    const soil = filterCatalog(GROUPS, { query: "soil moisture", source: "" });
    expect(soil.map((g) => g.source)).toEqual(expect.arrayContaining(["gldas", "giovanni"]));
    for (const e of soil.flatMap((g) => g.entries)) expect(`${e.name} ${e.description}`.toLowerCase()).toContain("soil");
    // "rain" is not in the precipitation names; the English synonyms find them.
    expect(keysOf(filterCatalog(GROUPS, { query: "rain", source: "" }))).toEqual(expect.arrayContaining(["imerg.precipitation", "noaa.PRCP"]));
    // Every word must match: a source name narrows a topic.
    const era5Temperature = keysOf(filterCatalog(GROUPS, { query: "era5 temperature", source: "" }));
    expect(era5Temperature.length).toBeGreaterThan(0);
    expect(era5Temperature.every((k) => k.startsWith("era5."))).toBe(true);
    expect(filterCatalog(GROUPS, { query: "no such variable zzz", source: "" })).toEqual([]);
  });

  it("filters by source and combines the filter with the search", () => {
    expect(filterCatalog(GROUPS, { query: "", source: "" })).toEqual(GROUPS);
    const era5 = filterCatalog(GROUPS, { query: "", source: "era5" });
    expect(era5.map((g) => g.id)).toEqual(["ERA5_SL_MONTHLY"]);
    expect(keysOf(era5)).toEqual(VARIABLES.filter((v) => v.source === "era5").map((v) => v.key));
    expect(filterCatalog(GROUPS, { query: "", source: "merra2" }).map((g) => g.label)).toEqual(["MERRA-2 SLV", "Derived from MERRA-2 SLV", "MERRA-2 FLX", "MERRA-2 LND", "MERRA-2 RAD", "MERRA-2 AER"]);
    expect(keysOf(filterCatalog(GROUPS, { query: "precipitation", source: "noaa" }))).toEqual(["noaa.PRCP"]);
    expect(filterCatalog(GROUPS, { query: "chlorophyll", source: "era5" })).toEqual([]);
  });

  it("matches one entry at a time and formats codes, coverage and labels", () => {
    const group = GROUPS.find((g) => g.id === "GPM_3IMERGM")!;
    expect(entryMatches(group.entries[0]!, group, "")).toBe(true);
    expect(entryMatches(group.entries[0]!, group, "gpm imerg")).toBe(true);
    expect(entryMatches(group.entries[0]!, group, "ozone")).toBe(false);
    expect(fieldCode("/Grid/precipitation")).toBe("precipitation");
    expect(fieldCode("T2M")).toBe("T2M");
    expect(coverageLabel({ start: "1997-09", end: "2010-12" })).toBe("Sep 1997 – Dec 2010");
    expect(coverageLabel({ start: "1940-01", end: null })).toBe("Jan 1940 – present");
    expect(groupLabel({ source: "merra2", shortName: "M2TMNXAER" })).toBe("MERRA-2 AER");
    expect(groupLabel({ source: "noaa", shortName: "NOAA_GSOM" })).toBe("NOAA stations");
  });
});
