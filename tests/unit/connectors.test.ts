/**
 * New connectors without network: OB.DAAC (OPeNDAP and the bounded cloud-file
 * fallback), Copernicus CDS jobs (NetCDF and ZIP results), Harmony/Giovanni
 * jobs, NOAA CDO stations, and the run executor waiting on provider jobs.
 * NetCDF-4 files are written with h5wasm in the test itself.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { COLLECTIONS, getCollection, getVariable, productLabel } from "@/src/catalog";
import { MemoryRunStore } from "@/src/db/store";
import { buildResult, executeRun } from "@/src/jobs/runner";
import { SelectionSchema } from "@/src/jobs/selection";
import { isStalled } from "@/src/jobs/service";
import { ProviderError, redirectLocation } from "@/src/lib/http";
import { accessChecks, buildPlan } from "@/src/plan/plan";
import { cdsConnector, cdsInputs, decodeEra5, mapCdsStatus } from "@/src/providers/cds";
import { findGranules } from "@/src/providers/cmr";
import { axisRange, coordinateAt, windowForBBox } from "@/src/providers/grid";
import { cubeUrl, harmonyConnector, mapHarmonyStatus, parseGiovanniCsv } from "@/src/providers/harmony";
import { era5GridStep, minStationMonths, OBDAAC_FILE_FALLBACK_MONTHS } from "@/src/providers/limits";
import { aggregateStations, extentsOf, noaaConnector, overlapFraction, rankStations, tenYearWindows } from "@/src/providers/noaa";
import { cloudFileUrl, readObdaacGranule } from "@/src/providers/obdaac";
import { planWindow } from "@/src/providers/gridded";
import { isWaiting, lonInBox, nextCheckDelaySeconds, type ProviderJobRow, type RemoteConnector, type RemoteContext } from "@/src/providers/remote";
import { isZip, unzip } from "@/src/providers/zip";

type H5 = (typeof import("h5wasm/node"))["default"];
type H5File = InstanceType<H5["File"]>;

async function makeNc(build: (file: H5File) => void): Promise<Uint8Array> {
  const mod = await import("h5wasm/node");
  const h5 = (mod as { default: H5 }).default;
  await h5.ready;
  const dir = mkdtempSync(join(tmpdir(), "cryonova-test-"));
  const path = join(dir, "test.nc");
  const file = new h5.File(path, "w");
  build(file);
  file.close();
  const bytes = new Uint8Array(readFileSync(path));
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

/** A stored (method 0) and a deflated (method 8) entry, as CDS returns for mixed step types. */
function makeZip(entries: Array<{ name: string; data: Uint8Array; deflate?: boolean }>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const body = e.deflate ? deflateRawSync(e.data) : Buffer.from(e.data);
    const name = Buffer.from(e.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(e.deflate ? 8 : 0, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.deflate ? 8 : 0, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}

const BOX = { west: -79, south: -4.25, east: -67, north: 12.5 };

/** ERA5-like file: 2 months x 3 latitudes (12.5, 4, -4) x 2 longitudes. */
async function era5File(variable = "t2m", units = "K", values = [300, 300, 290, 290, 280, 280, 301, 301, 291, 291, 281, 281]): Promise<Uint8Array> {
  return makeNc((f) => {
    f.create_dataset({ name: "latitude", data: new Float64Array([12.5, 4, -4]) });
    f.create_dataset({ name: "longitude", data: new Float64Array([-79, -70]) });
    const t = f.create_dataset({ name: "valid_time", data: new BigInt64Array([BigInt(Date.UTC(2010, 0, 1) / 1000), BigInt(Date.UTC(2010, 1, 1) / 1000)]) });
    t.create_attribute("units", "seconds since 1970-01-01");
    const v = f.create_dataset({ name: variable, data: new Float32Array(values), shape: [2, 3, 2], dtype: "<f" });
    v.create_attribute("units", units);
  });
}

function cosMean(rows: Array<[number, number]>): number {
  const w = rows.map(([lat]) => Math.cos((lat * Math.PI) / 180));
  return rows.reduce((s, [, v], i) => s + v * w[i]!, 0) / w.reduce((a, b) => a + b, 0);
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | undefined;
function fakeFetch(routes: Route[], calls: Array<{ url: string; init?: RequestInit }> = []) {
  return async (input: string, init?: RequestInit) => {
    calls.push({ url: input, init });
    for (const route of routes) {
      const out = await route(input, init);
      if (out) return out;
    }
    return new Response("not found", { status: 404 });
  };
}

describe("grids and discovery", () => {
  it("maps boxes onto descending (north-to-south) axes like SeaWiFS", () => {
    const grid = COLLECTIONS.SeaWiFS_L3m_CHL!.grid;
    const lat = axisRange(grid.lat, 2, 7)!;
    expect(coordinateAt(grid.lat, lat.start)).toBeLessThanOrEqual(7 + 1e-9);
    expect(coordinateAt(grid.lat, lat.stop)).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(lat.stop - lat.start + 1).toBe(60);
    const window = windowForBBox(grid, { west: -81, south: 2, east: -78, north: 7 });
    expect(window.cells).toBe(60 * 36);
    expect(axisRange({ start: 10, step: -1, count: 5 }, 20, 30)).toBeNull();
  });

  it("asks CMR for one granule name pattern and filters titles", async () => {
    const calls: Array<{ url: string }> = [];
    const fetchImpl = fakeFetch([
      (url) =>
        url.includes("granules.json")
          ? Response.json(
              { feed: { entry: [
                { id: "G1", title: "SeaWiFS_L3m_CHL_SEASTAR_SEAWIFS_GAC.20000601_20000630.L3m.MO.CHL.chlor_a.9km.nc_2022.0", time_start: "2000-06-01T00:00:00Z", links: [{ rel: "http://esipfed.org/ns/fedsearch/1.1/service#", href: "https://oceandata.sci.gsfc.nasa.gov/opendap/SeaWiFS/L3SMI/2000/0601/SEASTAR_SEAWIFS_GAC.20000601_20000630.L3m.MO.CHL.chlor_a.9km.nc" }] },
                { id: "G2", title: "SeaWiFS_L3m_CHL_SEASTAR_SEAWIFS_GAC.20000601.L3m.DAY.CHL.chlor_a.9km.nc_2022.0", time_start: "2000-06-01T00:00:00Z", links: [] },
              ] } },
              { headers: { "cmr-hits": "2" } },
            )
          : undefined,
    ], calls);
    const found = await findGranules("C3113254690-OB_CLOUD", "2000-06", "2000-06", { timeoutMs: 1000, retries: 0 }, fetchImpl, { titleFilter: ".L3m.MO.CHL.chlor_a.9km.nc" });
    expect(decodeURIComponent(calls[0]!.url)).toContain("readable_granule_name[]=*.L3m.MO.CHL.chlor_a.9km.nc*");
    expect(found.granules).toHaveLength(1);
    expect(found.granules[0]!.opendapUrl).toContain("oceandata.sci.gsfc.nasa.gov/opendap");
    expect(cloudFileUrl(found.granules[0]!.opendapUrl!)).toBe("https://obdaac-tea.earthdatacloud.nasa.gov/ob-cumulus-prod-public/SEASTAR_SEAWIFS_GAC.20000601_20000630.L3m.MO.CHL.chlor_a.9km.nc");
  });

  it("labels products and keeps verified metadata for the new collections", () => {
    expect(productLabel(COLLECTIONS.GLDAS_NOAH025_M!)).toBe("GLDAS_NOAH025_M v2.1");
    expect(productLabel(COLLECTIONS.ERA5_SL_MONTHLY!)).toBe("ERA5_SL_MONTHLY (CDS)");
    expect(COLLECTIONS.GLDAS_NOAH025_M!.fieldCount).toBe(36);
    expect(COLLECTIONS.SeaWiFS_L3m_CHL!.temporal).toEqual({ start: "1997-09", end: "2010-12" });
    expect(getVariable("era5.tp")!.providerUnits).toBe("m");
    expect(getVariable("seawifs.chlor_a")!.domain).toBe("ocean");
    expect(getVariable("noaa.PRCP")!.geometry).toBe("stations");
  });
});

describe("redirects and signed links", () => {
  it("returns the Location without following it and refuses Earthdata Login redirects", async () => {
    const fetchImpl = fakeFetch([
      (url, init) => {
        expect(init?.redirect).toBe("manual");
        return url.includes("good") ? new Response(null, { status: 303, headers: { location: "https://x.cloudfront.net/f.nc?Signature=abc" } }) : new Response(null, { status: 302, headers: { location: "https://urs.earthdata.nasa.gov/oauth/authorize" } });
      },
    ]);
    const ok = await redirectLocation("https://host/good", { Authorization: "Bearer t" }, { timeoutMs: 1000, retries: 0 }, fetchImpl);
    expect(ok.value).toBe("https://x.cloudfront.net/f.nc?Signature=abc");
    await expect(redirectLocation("https://host/bad", {}, { timeoutMs: 1000, retries: 0 }, fetchImpl)).rejects.toMatchObject({ kind: "unauthorized" });
    const noRedirect = fakeFetch([() => new Response("ok", { status: 200 })]);
    await expect(redirectLocation("https://host/x", {}, { timeoutMs: 1000, retries: 0 }, noRedirect)).rejects.toMatchObject({ kind: "bad_response" });
  });
});

describe("OB.DAAC reads", () => {
  const collection = getCollection("SeaWiFS_L3m_CHL")!;
  const variable = getVariable("seawifs.chlor_a")!;
  const opendapUrl = "https://oceandata.sci.gsfc.nasa.gov/opendap/SeaWiFS/L3SMI/2000/0601/SEASTAR_SEAWIFS_GAC.20000601_20000630.L3m.MO.CHL.chlor_a.9km.nc";
  // A 4 x 4 corner of the real grid (north-west), so the window maps onto it.
  const window = windowForBBox(collection.grid, { west: -180, south: 90 - 4 / 12, east: -180 + 4 / 12, north: 90 });

  async function l3mFile() {
    return makeNc((f) => {
      const lats = Array.from({ length: 4 }, (_, j) => 90 - 1 / 24 - j / 12);
      const lons = Array.from({ length: 4 }, (_, i) => -180 + 1 / 24 + i / 12);
      f.create_dataset({ name: "lat", data: new Float32Array(lats) });
      f.create_dataset({ name: "lon", data: new Float32Array(lons) });
      const chl = f.create_dataset({ name: "chlor_a", data: new Float32Array([0.1, 0.2, -32767, 0.4, 0.5, 0.6, 0.7, 0.8, 1, 1, 1, 1, -32767, -32767, -32767, -32767]), shape: [4, 4], dtype: "<f" });
      chl.create_attribute("_FillValue", new Float32Array([-32767]));
      chl.create_attribute("units", "mg m^-3");
    });
  }

  it("falls back to the cloud file after a 429, without sending the token to the signed link", async () => {
    const file = await l3mFile();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = fakeFetch([
      (url) => (url.startsWith(opendapUrl) ? new Response("Rate Limiting - Too Many Requests", { status: 429 }) : undefined),
      (url) => (url.startsWith("https://obdaac-tea.earthdatacloud.nasa.gov/") ? new Response(null, { status: 303, headers: { location: "https://dwgofd1fffpxv.cloudfront.net/file.nc?Signature=s" } }) : undefined),
      (url) => (url.startsWith("https://dwgofd1fffpxv.cloudfront.net/") ? new Response(file.slice().buffer) : undefined),
    ], calls);
    let reserved = 0;
    const read = await readObdaacGranule(opendapUrl, collection, [variable], window, { token: "secret-token", policy: { timeoutMs: 2000, retries: 0 }, fetchImpl, allowCloudFile: () => ++reserved <= 1 });
    expect(read.via).toBe("cloud-file");
    expect(read.fallbackReason).toContain("rate_limited");
    expect(read.values[0]!.validCells).toBe(11);
    expect(read.values[0]!.totalCells).toBe(16);
    expect(read.values[0]!.mean).toBeGreaterThan(0.5);
    const signed = calls.find((c) => c.url.includes("cloudfront"))!;
    expect(JSON.stringify(signed.init?.headers ?? {})).not.toContain("secret-token");
    const tea = calls.find((c) => c.url.includes("obdaac-tea"))!;
    expect(JSON.stringify(tea.init?.headers ?? {})).toContain("secret-token");

    // Limit reached: the month fails with a clear message instead of downloading another file.
    await expect(readObdaacGranule(opendapUrl, collection, [variable], window, { token: "t", policy: { timeoutMs: 2000, retries: 0 }, fetchImpl, allowCloudFile: () => false })).rejects.toThrow(/full-file fallback .* limited per run/);
  });

  it("stops asking OPeNDAP after repeated 429s in one invocation", async () => {
    const calls: Array<{ url: string }> = [];
    const fetchImpl = fakeFetch([(url) => (url.startsWith(opendapUrl) ? new Response("busy", { status: 429 }) : undefined)], calls);
    const breaker = { rateLimited: 0, threshold: 2 };
    for (let i = 0; i < 3; i += 1) {
      await expect(readObdaacGranule(opendapUrl, collection, [variable], window, { token: "t", policy: { timeoutMs: 2000, retries: 0 }, fetchImpl, allowCloudFile: () => false, breaker })).rejects.toBeInstanceOf(ProviderError);
    }
    expect(calls.filter((c) => c.url.startsWith(opendapUrl))).toHaveLength(2);
  });
});

describe("Copernicus CDS (ERA5)", () => {
  const variables = [getVariable("era5.t2m")!];
  const months = ["2010-01", "2010-02"];

  it("builds one request for the area and period, coarsening large areas", () => {
    const { inputs, step } = cdsInputs({ variables, bbox: BOX, months });
    expect(inputs).toMatchObject({ product_type: ["monthly_averaged_reanalysis"], variable: ["2m_temperature"], year: ["2010"], month: ["01", "02"], area: [12.5, -79, -4.25, -67], data_format: "netcdf" });
    expect(step).toBe(0.25);
    expect("grid" in inputs).toBe(false);
    const world = cdsInputs({ variables, bbox: { west: -180, south: -90, east: 180, north: 90 }, months });
    expect(world.step).toBeGreaterThan(0.25);
    expect(world.inputs).toHaveProperty("grid", [world.step, world.step]);
    expect(era5GridStep(BOX, 240, 4)).toBe(0.25);
    expect(era5GridStep({ west: -75, south: -35, east: -35, north: 5 }, 240, 4)).toBe(0.5);
    expect(mapCdsStatus("successful")).toBe("successful");
    expect(mapCdsStatus("dismissed")).toBe("failed");
    expect(mapCdsStatus(undefined)).toBe("running");
  });

  it("decodes NetCDF and ZIP results into cos-latitude weighted means and checks units", async () => {
    const nc = await era5File();
    const decoded = await decodeEra5([nc], variables, BOX, months);
    expect(decoded.months.map((m) => m.month)).toEqual(months);
    expect(decoded.months[0]!.values[0]!.mean).toBeCloseTo(cosMean([[12.5, 300], [4, 290], [-4, 280]]), 4);
    expect(decoded.months[1]!.values[0]!.validCells).toBe(6);
    const zipped = makeZip([{ name: "data_stream-moda_stepType-avgua.nc", data: nc, deflate: true }, { name: "data_stream-moda_stepType-avgad.nc", data: await era5File("tp", "m", Array(12).fill(0.004)) }]);
    expect(isZip(zipped)).toBe(true);
    const files = unzip(zipped);
    expect(files.map((f) => f.name)).toEqual(["data_stream-moda_stepType-avgua.nc", "data_stream-moda_stepType-avgad.nc"]);
    const both = await decodeEra5(files.map((f) => f.data), [getVariable("era5.t2m")!, getVariable("era5.tp")!], BOX, months);
    expect(both.months[0]!.values.map((v) => v.key).sort()).toEqual(["era5.t2m", "era5.tp"]);
    await expect(decodeEra5([await era5File("t2m", "degC")], variables, BOX, months)).rejects.toThrow(/arrived in degC/);
  });

  it("submits once, checks briefly and fetches the signed result without the key", async () => {
    const nc = await era5File();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let status = "accepted";
    const fetchImpl = fakeFetch([
      (url, init) => (url.endsWith("/execution") && init?.method === "POST" ? Response.json({ jobID: "job-1", status: "accepted" }, { status: 201 }) : undefined),
      (url) => (url.endsWith("/retrieve/v1/jobs/job-1") ? Response.json({ status, started: null, finished: null }) : undefined),
      (url) => (url.endsWith("/retrieve/v1/jobs/job-1/results") ? Response.json({ asset: { value: { href: "https://object-store.os-api.cci2.ecmwf.int/cache/x.nc" } } }) : undefined),
      (url) => (url.startsWith("https://object-store") ? new Response(nc.slice().buffer) : undefined),
    ], calls);
    const ctx: RemoteContext = { runId: "r", collection: getCollection("ERA5_SL_MONTHLY")!, variables, bbox: BOX, start: "2010-01", end: "2010-02", months, credentials: { cdsKey: "cds-secret", cdsUrl: "https://cds.example/api" }, fetchImpl };
    const submitted = await cdsConnector.submit(ctx, "all");
    expect(submitted).toMatchObject({ jobRef: "job-1", status: "accepted" });
    const job = { runId: "r", collection: "ERA5_SL_MONTHLY", jobKey: "all", provider: "cds", jobRef: "job-1", status: "accepted", request: submitted.request, meta: null, message: null, submittedAt: new Date(), checkedAt: null, nextCheckAt: null, completedAt: null, checks: 0 } satisfies ProviderJobRow;
    expect((await cdsConnector.check(ctx, job)).status).toBe("accepted");
    status = "successful";
    expect((await cdsConnector.check(ctx, job)).status).toBe("successful");
    const fetched = await cdsConnector.fetch(ctx, { ...job, status: "successful" });
    expect(fetched.months).toHaveLength(2);
    expect(fetched.bytes).toBe(nc.byteLength);
    const download = calls.find((c) => c.url.startsWith("https://object-store"))!;
    expect(JSON.stringify(download.init?.headers ?? {})).not.toContain("cds-secret");
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(1);
    await expect(cdsConnector.submit({ ...ctx, credentials: {} }, "all")).rejects.toMatchObject({ kind: "unauthorized" });
  });
});

describe("Harmony / Giovanni", () => {
  const csv = readFileSync("tests/fixtures/harmony/giovanni-gldas-area-2010.csv", "utf8");
  const variable = getVariable("giovanni.GLDAS_SoilMoi0_10cm")!;

  it("parses Giovanni's area-average CSV", () => {
    const rows = parseGiovanniCsv(csv, variable.dapName, variable.fillValue);
    expect(rows).toHaveLength(12);
    expect(rows.find((r) => r.month === "2010-06")!.value).toBeCloseTo(36.234146, 6);
    expect(() => parseGiovanniCsv(csv, "mean_other", -9999)).toThrow(/no column/);
    expect(parseGiovanniCsv("Fill Value:,-9999.0\ntime,mean_x\n2010-01-01T00:00:00,-9999.0\n", "mean_x", -9999)[0]!.value).toBeNull();
    expect(mapHarmonyStatus("complete_with_errors")).toBe("successful");
    expect(mapHarmonyStatus("canceled")).toBe("failed");
  });

  it("runs the job flow with the token only on Harmony", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const id = "90c61434-4582-409d-aa6a-3c7a67fe6c2c";
    const fetchImpl = fakeFetch([
      (url) => (url.includes("/ogc-api-edr/") ? new Response(null, { status: 303, headers: { location: `/jobs/${id}` } }) : undefined),
      (url) => (url.endsWith(`/jobs/${id}`) ? Response.json({ status: "successful", progress: 100, links: [{ rel: "data", href: `https://harmony.earthdata.nasa.gov/service-results/x/${id}/out.csv` }] }) : undefined),
      (url) => (url.includes("/service-results/") ? new Response(null, { status: 307, headers: { location: "https://dqzb5lcolc8fj.cloudfront.net/out.csv?Signature=s" } }) : undefined),
      (url) => (url.includes("cloudfront.net") ? new Response(csv) : undefined),
    ], calls);
    const ctx: RemoteContext = { runId: "r", collection: getCollection("GIOVANNI_GLDAS_NOAH025_M")!, variables: [variable], bbox: BOX, start: "2010-01", end: "2010-12", months: Array.from({ length: 12 }, (_, i) => `2010-${String(i + 1).padStart(2, "0")}`), credentials: { earthdataToken: "edl-secret" }, fetchImpl };
    expect(decodeURIComponent(cubeUrl(ctx, variable.requestName!))).toContain("bbox=-79,-4.25,-67,12.5");
    const submitted = await harmonyConnector.submit(ctx, variable.key);
    expect(submitted.jobRef).toBe(id);
    const job = { runId: "r", collection: ctx.collection.shortName, jobKey: variable.key, provider: "harmony", jobRef: id, status: "accepted", request: submitted.request, meta: null, message: null, submittedAt: new Date(), checkedAt: null, nextCheckAt: null, completedAt: null, checks: 0 } satisfies ProviderJobRow;
    expect((await harmonyConnector.check(ctx, job)).message).toContain("successful (100%)");
    const fetched = await harmonyConnector.fetch(ctx, { ...job, status: "successful" });
    expect(fetched.months.find((m) => m.month === "2010-06")!.values[0]!.mean).toBeCloseTo(36.234146, 6);
    expect(JSON.stringify(calls.find((c) => c.url.includes("cloudfront"))!.init?.headers ?? {})).not.toContain("edl-secret");
  });
});

describe("NOAA CDO stations", () => {
  const stations = [
    { id: "GHCND:A", name: "A", latitude: 4, longitude: -74, elevation: 2500, mindate: "1960-01-01", maxdate: "2025-07-01", datacoverage: 0.9 },
    { id: "GHCND:B", name: "B", latitude: 5, longitude: -75, elevation: 100, mindate: "2012-01-01", maxdate: "2025-07-01", datacoverage: 1 },
    { id: "GHCND:C", name: "C", latitude: 6, longitude: -76, mindate: "1950-01-01", maxdate: "1990-01-01", datacoverage: 1 },
  ];

  it("ranks stations by period overlap and coverage and splits requests into ten-year windows", () => {
    expect(overlapFraction(stations[2]!, "2005-01", "2014-12")).toBe(0);
    const ranked = rankStations(stations, "2005-01", "2014-12");
    expect(ranked.map((s) => s.id)).toEqual(["GHCND:A", "GHCND:B"]);
    expect(tenYearWindows("1995-06", "2024-12")).toEqual([{ start: "1995-06", end: "2004-12" }, { start: "2005-01", end: "2014-12" }, { start: "2015-01", end: "2024-12" }]);
    expect(extentsOf({ west: 170, south: -10, east: -170, north: 10 })).toHaveLength(2);
    expect(minStationMonths(120)).toBe(30);
    expect(minStationMonths(6)).toBe(6);
  });

  it("averages reporting stations and keeps every station as a point", () => {
    const months = Array.from({ length: 12 }, (_, i) => `2010-${String(i + 1).padStart(2, "0")}`);
    const records = [
      ...months.map((month, i) => ({ station: "GHCND:A", datatype: "PRCP", month, value: 10 + i })),
      ...months.map((month, i) => ({ station: "GHCND:B", datatype: "PRCP", month, value: 30 + i })),
      { station: "GHCND:C", datatype: "PRCP", month: "2010-01", value: 99 },
    ];
    const infos = rankStations(stations.map((s) => ({ ...s, maxdate: "2025-01-01", mindate: "2000-01-01" })), "2010-01", "2010-12");
    const { months: out, used } = aggregateStations(records, [getVariable("noaa.PRCP")!], infos, months);
    expect(used["noaa.PRCP"]!.sort()).toEqual(["GHCND:A", "GHCND:B"]);
    expect(out[0]!.values[0]!.mean).toBe(20);
    expect(out[0]!.values[0]!.points).toHaveLength(3);
  });

  it("searches, paginates and tolerates empty answers", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = fakeFetch([
      (url) => (url.includes("/stations?") ? Response.json({ metadata: { resultset: { offset: 1, count: 2, limit: 1000 } }, results: stations.slice(0, 2) }) : undefined),
      (url) => (url.includes("stationid=GHCND%3AB") ? new Response("{}") : undefined),
      (url) => {
        if (!url.includes("/data?")) return undefined;
        const offset = Number(new URL(url).searchParams.get("offset"));
        const results = offset === 1 ? [{ date: "2010-01-01T00:00:00", datatype: "PRCP", station: "GHCND:A", value: 27.2 }] : [{ date: "2010-02-01T00:00:00", datatype: "PRCP", station: "GHCND:A", value: 8.2 }];
        return Response.json({ metadata: { resultset: { offset, count: 1001, limit: 1000 } }, results });
      },
    ], calls);
    const ctx: RemoteContext = { runId: "r", collection: getCollection("NOAA_GSOM")!, variables: [getVariable("noaa.PRCP")!], bbox: BOX, start: "2010-01", end: "2010-02", months: ["2010-01", "2010-02"], credentials: { noaaToken: "noaa-secret" }, fetchImpl };
    const submitted = await noaaConnector.submit(ctx, "stations");
    expect(submitted.status).toBe("successful");
    const job = { runId: "r", collection: "NOAA_GSOM", jobKey: "stations", provider: "noaa-cdo", jobRef: null, status: "successful", request: submitted.request, meta: submitted.meta ?? null, message: null, submittedAt: new Date(), checkedAt: null, nextCheckAt: null, completedAt: null, checks: 0 } satisfies ProviderJobRow;
    const fetched = await noaaConnector.fetch(ctx, job);
    expect(fetched.months.map((m) => m.values[0]!.points?.length)).toEqual([1, 1]);
    expect(fetched.exampleRequest).not.toContain("noaa-secret");
    expect(calls.every((c) => !c.url.includes("noaa-secret"))).toBe(true);
  });
});

describe("runs that wait on provider jobs", () => {
  const selection = SelectionSchema.parse({ question: "ERA5 test", region: { bbox: BOX, name: "Colombia box", source: "coordinates" }, start: "2010-01", end: "2010-12", variables: ["era5.t2m"], mode: "manual" });
  const months = Array.from({ length: 12 }, (_, i) => `2010-${String(i + 1).padStart(2, "0")}`);

  function fakeCds(state: { status: "accepted" | "successful"; submits: number; checks: number }): RemoteConnector {
    return {
      provider: "cds",
      jobKeys: () => ["all"],
      submit: async () => {
        state.submits += 1;
        return { jobRef: "job-9", status: "accepted", request: { url: "https://cds.example/execution" } };
      },
      check: async () => {
        state.checks += 1;
        return { status: state.status, message: `CDS job ${state.status}` };
      },
      fetch: async () => ({ months: months.map((month, i) => ({ month, values: [{ key: "era5.t2m", mean: 290 + (i % 12) / 10, validCells: 10, totalCells: 10 }] })), bytes: 1234, durationMs: 50, attempts: 2, exampleRequest: "POST https://cds.example/execution → job job-9" }),
    };
  }

  it("submits once, releases the run with waitUntil, then finishes when the job is ready", async () => {
    const store = new MemoryRunStore();
    const { run } = await store.createRun({ id: crypto.randomUUID(), selection, idempotencyKey: crypto.randomUUID(), clientKey: "t" });
    const state = { status: "accepted" as "accepted" | "successful", submits: 0, checks: 0 };
    let clock = Date.parse("2026-11-15T09:00:00Z");
    const deps = { store, connectors: { cds: fakeCds(state) }, now: () => new Date(clock), credentials: { cdsKey: "k" } };

    const first = await executeRun(run.id, deps);
    expect(first?.status).toBe("queued");
    expect(first?.progress.message).toMatch(/Copernicus CDS job job-9 accepted/);
    expect(first?.progress.waitUntil).toBe("2026-11-15T09:00:10.000Z");
    expect(isStalled(first!, new Date(clock + 5_000))).toBe(false);
    expect(isStalled(first!, new Date(clock + 11_000))).toBe(true);

    clock += 11_000;
    const second = await executeRun(run.id, deps);
    expect(second?.status).toBe("queued");
    expect(state).toMatchObject({ submits: 1, checks: 1 });

    state.status = "successful";
    clock += 16_000;
    const done = await executeRun(run.id, deps);
    expect(done?.status).toBe("succeeded");
    expect(state.submits).toBe(1);
    const result = done!.result!;
    expect(result.sources[0]).toMatchObject({ label: "ERA5_SL_MONTHLY (CDS)", kind: "grid", monthsRead: 12, servedBy: "Copernicus Climate Data Store" });
    expect(result.sources[0]!.jobs![0]).toMatchObject({ jobRef: "job-9", status: "fetched" });
    expect(result.variables[0]!.analysis.monthly[0]!.value).toBeCloseTo(290 - 273.15, 6);
    const checks = await store.listConnectorChecks();
    expect(checks.find((c) => c.connector === "era5")).toMatchObject({ ok: true, units: "°C", runId: run.id });
  });

  it("marks the months failed when the provider job fails", async () => {
    const store = new MemoryRunStore();
    const { run } = await store.createRun({ id: crypto.randomUUID(), selection, idempotencyKey: crypto.randomUUID(), clientKey: "t" });
    const failing: RemoteConnector = { ...fakeCds({ status: "accepted", submits: 0, checks: 0 }), check: async () => ({ status: "failed", message: "CDS job failed: licence not accepted" }) };
    let clock = Date.parse("2026-11-15T09:00:00Z");
    const deps = { store, connectors: { cds: failing }, now: () => new Date(clock), credentials: { cdsKey: "k" } };
    await executeRun(run.id, deps);
    clock += 11_000;
    const done = await executeRun(run.id, deps);
    expect(done?.status).toBe("failed");
    expect(done?.result?.warnings.join(" ")).toMatch(/licence not accepted/);
  });

  it("builds station results with point data and a partial status when no regional series exists", () => {
    const sel = SelectionSchema.parse({ question: "NOAA", region: { bbox: BOX, name: "Colombia box", source: "coordinates" }, start: "2010-01", end: "2010-12", variables: ["noaa.PRCP"], mode: "manual" });
    const runRow = { id: "11111111-1111-4111-8111-111111111111", createdAt: new Date(), startedAt: new Date() };
    const samples = months.map((month) => ({ runId: runRow.id, collection: "NOAA_GSOM", month, status: "missing", granuleId: null, granuleTitle: null, opendapUrl: null, values: [{ key: "noaa.PRCP", mean: null, validCells: 0, totalCells: 0, points: month < "2010-04" ? [{ id: "GHCND:A", value: 25 }] : [] }], bytes: 0, durationMs: 0, attempts: 1, error: null, fetchedAt: new Date(), via: "noaa-cdo" }));
    const job = { runId: runRow.id, collection: "NOAA_GSOM", jobKey: "stations", provider: "noaa-cdo", jobRef: null, status: "fetched", request: { urls: ["https://www.ncei.noaa.gov/cdo-web/api/v2/stations?x"] }, meta: { stations: [{ id: "GHCND:A", name: "A", lat: 4, lon: -74, elevation: 2500, mindate: "1960-01-01", maxdate: "2025-01-01", datacoverage: 0.5 }], used: { "noaa.PRCP": [] } }, message: null, submittedAt: new Date(), checkedAt: null, nextCheckAt: null, completedAt: new Date(), checks: 0 } satisfies ProviderJobRow;
    const result = buildResult(runRow as never, sel, samples as never, { analysisStart: Date.now(), invocationStart: Date.now(), concurrency: 6, invocations: 1 }, [job]);
    expect(result.status).toBe("partial");
    expect(result.sources[0]).toMatchObject({ kind: "stations", window: { cells: 0, nativeCells: 1 } });
    expect(result.variables[0]!.stations![0]).toMatchObject({ id: "GHCND:A", monthsValid: 3, mean: 25, usedInRegionalMean: false });
    expect(result.warnings.join(" ")).toMatch(/point data/);
  });
});

describe("plan and selection for the new sources", () => {
  it("warns when a SeaWiFS range is too long for the full-file fallback", () => {
    const checks = accessChecks(["SeaWiFS_L3m_CHL"], 120, null);
    expect(checks.some((c) => c.level === "warn" && c.text.includes(`at most ${OBDAAC_FILE_FALLBACK_MONTHS} months per run`))).toBe(true);
    expect(accessChecks(["SeaWiFS_L3m_CHL"], 12, null).some((c) => c.level === "warn")).toBe(false);
    expect(accessChecks(["ERA5_SL_MONTHLY"], 120, BOX)[0]!.text).toMatch(/queued job/);
    expect(accessChecks(["NOAA_GSOM"], 120, BOX)[0]!.text).toMatch(/at least 30 months/);
    expect(accessChecks(["GIOVANNI_GPM_3IMERGM"], 120, BOX)[0]!.text).toMatch(/Giovanni computes the area average/);
  });

  it("shows the plan warning for a ten-year SeaWiFS investigation", () => {
    const plan = buildPlan({ question: "Has ocean chlorophyll changed off Colombia?", location: { mode: "custom", regionId: null, bbox: { west: -81, south: 2, east: -78, north: 7 } }, start: "2000-01", end: "2009-12", variables: ["seawifs.chlor_a"], derived: [] } as never);
    expect(plan.checks.find((c) => c.level === "warn" && c.text.includes("too long for the full-file fallback"))).toBeTruthy();
  });

  it("rejects areas crossing the 180° meridian for CDS and Harmony", () => {
    const parsed = SelectionSchema.safeParse({ question: "x", region: { bbox: { west: 170, south: -10, east: -170, north: 10 }, source: "coordinates" }, start: "2010-01", end: "2010-12", variables: ["era5.t2m"], mode: "manual" });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/180° meridian/);
  });

  it("schedules job checks and recognises waiting states", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(nextCheckDelaySeconds)).toEqual([10, 15, 20, 30, 45, 60, 60]);
    expect(isWaiting("accepted")).toBe(true);
    expect(isWaiting("fetched")).toBe(false);
    expect(lonInBox(185, { west: 170, south: 0, east: -170, north: 1 })).toBe(true);
    expect(planWindow(getCollection("ERA5_SL_MONTHLY")!, BOX).cells).toBe(68 * 49);
  });
});
