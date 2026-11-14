import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { IMERG_COLLECTIONS, IMERG_VARIABLES } from "@/src/catalog/imerg";
import { MERRA2_COLLECTIONS } from "@/src/catalog/merra2";
import { getVariable } from "@/src/catalog";
import { findGranules, lastDayOfMonth, pickOpendapUrl } from "@/src/providers/cmr";
import { buildConstraint, isValidValue, readGranule } from "@/src/providers/gridded";
import { windowForBBox } from "@/src/providers/grid";

const slv = MERRA2_COLLECTIONS.M2TMNXSLV!;
const t2m = getVariable("merra2.T2M")!;
const policy = { timeoutMs: 1_000, retries: 0 };

function cmrEntry(month: string, title: string) {
  return {
    id: `G-${title}`,
    title,
    time_start: `${month}-01T00:00:00.000Z`,
    links: [
      { rel: "http://esipfed.org/ns/fedsearch/1.1/data#", href: "https://data.example/file.nc4" },
      { rel: "http://esipfed.org/ns/fedsearch/1.1/service#", href: `https://opendap.earthdata.nasa.gov/collections/C1/granules/${title}` },
    ],
  };
}

describe("CMR discovery", () => {
  it("computes month ends including leap years", () => {
    expect(lastDayOfMonth("2024-02")).toBe("2024-02-29");
    expect(lastDayOfMonth("2025-02")).toBe("2025-02-28");
    expect(lastDayOfMonth("2025-12")).toBe("2025-12-31");
  });

  it("prefers Cloud OPeNDAP service links", () => {
    expect(pickOpendapUrl(cmrEntry("2005-01", "A").links)).toContain("opendap.earthdata.nasa.gov");
    expect(pickOpendapUrl([{ rel: "x/service#", href: "https://goldsmr4.example/opendap/" }])).toBeNull();
    expect(pickOpendapUrl(undefined)).toBeNull();
  });

  it("keeps one granule per month, preferring reprocessed streams", async () => {
    const body = { feed: { entry: [cmrEntry("2020-08", "MERRA2_400.x.202008"), cmrEntry("2020-09", "MERRA2_400.x.202009"), cmrEntry("2020-09", "MERRA2_401.x.202009"), cmrEntry("2020-11", "out-of-range")] } };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { headers: { "cmr-hits": "4" } }));
    const result = await findGranules("C1", "2020-08", "2020-10", policy, fetchImpl);
    expect(result.granules.map((g) => g.title)).toEqual(["MERRA2_400.x.202008", "MERRA2_401.x.202009"]);
    expect(result.duplicateMonths).toEqual(["2020-09"]);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("temporal=2020-08-01T00%3A00%3A00Z%2C2020-10-31T23%3A59%3A59Z");
  });
});

describe("gridded reader", () => {
  it("builds constraints in each product's dimension order", () => {
    const w = windowForBBox(slv.grid, { west: -79, south: -4.2, east: -66.85, north: 12.5 });
    expect(buildConstraint(slv, [t2m], w, w.lon[0]!)).toBe("T2M%5B0:0%5D%5B172:205%5D%5B162:181%5D,lat%5B172:205%5D,lon%5B162:181%5D");
    const imerg = IMERG_COLLECTIONS.GPM_3IMERGM!;
    const wi = windowForBBox(imerg.grid, { west: -75, south: 4, east: -74, north: 5 });
    expect(buildConstraint(imerg, IMERG_VARIABLES, wi, wi.lon[0]!)).toMatch(/^%2FGrid%2Fprecipitation%5B0:0%5D%5B1050:1059%5D%5B940:949%5D,/);
  });

  it("treats fill values and non-finite numbers as missing", () => {
    expect(isValidValue(298.1, 9.99999987e14)).toBe(true);
    expect(isValidValue(9.99999987e14, 9.99999987e14)).toBe(false);
    expect(isValidValue(-9999.900391, -9999.900391)).toBe(false);
    expect(isValidValue(Number.NaN, -9999.9)).toBe(false);
    expect(isValidValue(0, -9999.9)).toBe(true);
  });

  it("reads a granule end to end from the live fixture without exposing the token in URLs", async () => {
    const bytes = readFileSync(new URL("../fixtures/opendap/merra2_slv_200501_colombia_t2m.dods", import.meta.url));
    const fetchImpl = vi.fn().mockResolvedValue(new Response(bytes));
    const w = windowForBBox(slv.grid, { west: -79, south: -4.2, east: -66.85, north: 12.5 });
    const read = await readGranule("https://opendap.example/granule.nc4", slv, [t2m], w, { token: "secret-token", policy, fetchImpl });
    expect(read.values[0]?.mean).toBeCloseTo(298.373, 3);
    expect(read.values[0]?.validCells).toBe(680);
    expect(read.urls.join(" ")).not.toContain("secret-token");
    expect((fetchImpl.mock.calls[0]![1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer secret-token" });
  });

  it("classifies a non-DAP body as a bad provider response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("<html>login</html>"));
    const w = windowForBBox(slv.grid, { west: -79, south: -4.2, east: -66.85, north: 12.5 });
    await expect(readGranule("https://opendap.example/g", slv, [t2m], w, { token: "t", policy, fetchImpl })).rejects.toMatchObject({ kind: "bad_response" });
  });
});
