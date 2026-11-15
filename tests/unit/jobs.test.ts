import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryRunStore } from "@/src/db/store";
import { buildResult, executeRun } from "@/src/jobs/runner";
import { groupByCollection, SelectionSchema } from "@/src/jobs/selection";
import { isStalled, publicRun, startRun } from "@/src/jobs/service";
import { cornersToBBox, bboxToCorners, bboxAreaDeg2, wrapLongitude } from "@/src/lib/geo";

const fixture = readFileSync(new URL("../fixtures/opendap/merra2_slv_200501_colombia_t2m.dods", import.meta.url));
const colombia = { west: -79, south: -4.2, east: -66.85, north: 12.5 };

function selection(overrides: Record<string, unknown> = {}) {
  return SelectionSchema.parse({ region: { bbox: colombia, name: "Colombia", source: "named" }, start: "2015-01", end: "2016-12", variables: ["merra2.T2M"], ...overrides });
}

function cmrBody(months: string[]) {
  return {
    feed: {
      entry: months.map((m) => ({
        id: `G${m}`,
        title: `MERRA2_400.tavgM_2d_slv_Nx.${m.replace("-", "")}.nc4`,
        time_start: `${m}-01T00:00:00.000Z`,
        links: [{ rel: "http://esipfed.org/ns/fedsearch/1.1/service#", href: `https://opendap.earthdata.nasa.gov/granules/${m}` }],
      })),
    },
  };
}

function months(start: string, n: number): string[] {
  const out: string[] = [];
  let [y, m] = start.split("-").map(Number) as [number, number];
  for (let i = 0; i < n; i += 1) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function fakeProvider(options: { opendapStatus?: number; cmrStatus?: number; onRead?: () => void } = {}) {
  let reads = 0;
  const fetchImpl = async (url: string) => {
    if (url.includes("cmr.earthdata.nasa.gov")) {
      if (options.cmrStatus) return new Response("unavailable", { status: options.cmrStatus });
      return new Response(JSON.stringify(cmrBody(months("2015-01", 24))), { headers: { "cmr-hits": "24" } });
    }
    reads += 1;
    options.onRead?.();
    if (options.opendapStatus) return new Response("denied", { status: options.opendapStatus });
    return new Response(fixture);
  };
  return { fetchImpl, reads: () => reads };
}

async function newRun(store: MemoryRunStore, key = crypto.randomUUID()) {
  const out = await startRun(selection(), { idempotencyKey: key, clientKey: "test" }, store);
  if ("limited" in out) throw new Error("limited");
  return out.run;
}

describe("selection contract", () => {
  it("accepts a valid selection and groups variables by collection", () => {
    const s = selection({ variables: ["merra2.T2M", "merra2.QV2M", "merra2.PRECTOTCORR"] });
    expect([...groupByCollection(s).entries()]).toEqual([
      ["M2TMNXSLV", ["merra2.T2M", "merra2.QV2M"]],
      ["M2TMNXFLX", ["merra2.PRECTOTCORR"]],
    ]);
    expect(s.mode).toBe("manual");
  });

  it.each([
    [{ start: "2016-01", end: "2015-01" }, /end month/],
    [{ variables: ["merra2.NOPE"] }, /Unknown variables/],
    [{ variables: ["merra2.T2M", "merra2.T2M"] }, /once/],
    [{ start: "1979-01" }, /starts in 1980-01/],
    [{ variables: ["imerg.precipitation"], end: "2025-12" }, /declared until 2025-09/],
    [{ start: "1980-01", end: "2024-12", variables: ["merra2.T2M", "merra2.PRECTOTCORR", "merra2.GWETTOP"] }, /provider reads/],
    [{ variables: [] }, /at least one/],
    [{ region: { bbox: { west: 0, south: 10, east: 5, north: 0 } } }, /North must be greater/],
  ])("rejects %j", (patch, message) => {
    const result = SelectionSchema.safeParse({ region: { bbox: colombia }, start: "2015-01", end: "2016-12", variables: ["merra2.T2M"], ...patch });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message).join(" ")).toMatch(message);
  });
});

describe("durable executor", () => {
  it("discovers, reads, analyzes and records provenance", async () => {
    const store = new MemoryRunStore();
    const run = await newRun(store);
    const provider = fakeProvider();
    const final = await executeRun(run.id, { store, earthdataToken: "t", fetchImpl: provider.fetchImpl, concurrency: 4 });
    expect(final?.status).toBe("succeeded");
    expect(provider.reads()).toBe(24);
    const v = final!.result!.variables[0]!;
    expect(v.analysis.monthly).toHaveLength(24);
    expect(v.analysis.monthly[0]!.value).toBeCloseTo(298.373 - 273.15, 3);
    expect(v.analysis.trend.status).toBe("insufficient");
    const source = final!.result!.sources[0]!;
    expect(source).toMatchObject({ collection: "M2TMNXSLV", monthsRead: 24, monthsFailed: 0, monthsMissing: 0, conceptId: "C1276812859-GES_DISC" });
    expect(source.exampleRequest).not.toContain("token");
    expect(final!.progress.phase).toBe("done");
    expect(publicRun(final!).result).not.toBeNull();
  });

  it("is idempotent per key and exclusive per lease", async () => {
    const store = new MemoryRunStore();
    const a = await startRun(selection(), { idempotencyKey: "same", clientKey: "c" }, store);
    const b = await startRun(selection(), { idempotencyKey: "same", clientKey: "c" }, store);
    expect("run" in a && "run" in b && a.run.id === b.run.id).toBe(true);
    expect("created" in b && b.created).toBe(false);
    const id = "run" in a ? a.run.id : "";
    expect(await store.acquireLease(id, "w1", 60_000)).not.toBeNull();
    expect(await store.acquireLease(id, "w2", 60_000)).toBeNull();
    expect(await executeRun(id, { store, earthdataToken: "t", fetchImpl: fakeProvider().fetchImpl })).toBeNull();
  });

  it("pauses when the invocation budget ends and resumes without re-reading", async () => {
    const store = new MemoryRunStore();
    const run = await newRun(store);
    const provider = fakeProvider();
    const paused = await executeRun(run.id, { store, earthdataToken: "t", fetchImpl: provider.fetchImpl, budgetMs: 0 });
    expect(paused?.status).toBe("queued");
    expect(paused?.progress.phase).toBe("reading");
    expect(isStalled(paused!)).toBe(true);
    const done = await executeRun(run.id, { store, earthdataToken: "t", fetchImpl: provider.fetchImpl });
    expect(done?.status).toBe("succeeded");
    expect(provider.reads()).toBe(24);
    expect(done?.result?.timings.invocations).toBe(2);
  });

  it("stops at the next checkpoint after cancellation", async () => {
    const store = new MemoryRunStore();
    const run = await newRun(store);
    let count = 0;
    const provider = fakeProvider({
      onRead: () => {
        count += 1;
        if (count === 3) void store.requestCancel(run.id);
      },
    });
    const final = await executeRun(run.id, { store, earthdataToken: "t", fetchImpl: provider.fetchImpl, concurrency: 1, flushEvery: 1 });
    expect(final?.status).toBe("cancelled");
    expect(provider.reads()).toBeLessThan(24);
  });

  it("cancels a queued run immediately", async () => {
    const store = new MemoryRunStore();
    const run = await newRun(store);
    expect((await store.requestCancel(run.id))?.status).toBe("cancelled");
    expect(await executeRun(run.id, { store, earthdataToken: "t", fetchImpl: fakeProvider().fetchImpl })).toBeNull();
  });

  it("reports provider authorization failures as failed reads and a failed run", async () => {
    const store = new MemoryRunStore();
    const run = await newRun(store);
    const final = await executeRun(run.id, { store, earthdataToken: "t", fetchImpl: fakeProvider({ opendapStatus: 403 }).fetchImpl, concurrency: 6 });
    expect(final?.status).toBe("failed");
    expect(final?.error?.kind).toBe("no_data");
    const samples = await store.listSamples(run.id, ["failed"]);
    expect(samples).toHaveLength(24);
    expect(samples[0]?.error).toMatch(/^forbidden: HTTP 403/);
  });

  it("fails clearly when discovery is down or the token is missing", async () => {
    const store = new MemoryRunStore();
    const run = await newRun(store);
    const down = await executeRun(run.id, { store, earthdataToken: "t", fetchImpl: fakeProvider({ cmrStatus: 503 }).fetchImpl });
    expect(down?.status).toBe("failed");
    expect(down?.error).toMatchObject({ kind: "server", host: "cmr.earthdata.nasa.gov" });
    const previous = process.env.EARTHDATA_TOKEN;
    delete process.env.EARTHDATA_TOKEN;
    const other = await newRun(store);
    const missing = await executeRun(other.id, { store, fetchImpl: fakeProvider().fetchImpl });
    if (previous !== undefined) process.env.EARTHDATA_TOKEN = previous;
    expect(missing?.error?.kind).toBe("configuration");
  });

  it("rate-limits run creation per client", async () => {
    const store = new MemoryRunStore();
    process.env.RUNS_PER_HOUR_PER_CLIENT = "2";
    await startRun(selection(), { idempotencyKey: "a", clientKey: "x" }, store);
    await startRun(selection(), { idempotencyKey: "b", clientKey: "x" }, store);
    const third = await startRun(selection(), { idempotencyKey: "c", clientKey: "x" }, store);
    delete process.env.RUNS_PER_HOUR_PER_CLIENT;
    expect("limited" in third && third.limited).toBe(true);
  });
});

describe("map geometry", () => {
  it("normalizes corners, including boxes drawn across the antimeridian", () => {
    expect(cornersToBBox({ lat: 12.4, lng: -66.9 }, { lat: -4.3, lng: -79 })).toEqual({ west: -79, south: -4.3, east: -66.9, north: 12.4 });
    expect(cornersToBBox({ lat: -20, lng: 170 }, { lat: -10, lng: 190 })).toEqual({ west: 170, south: -20, east: -170, north: -10 });
    expect(cornersToBBox({ lat: -95, lng: -400 }, { lat: 95, lng: 400 })).toEqual({ west: -180, south: -90, east: 180, north: 90 });
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(180)).toBe(180);
    expect(bboxToCorners({ west: 170, south: -20, east: -170, north: -10 })).toEqual([
      [-20, 170],
      [-10, 190],
    ]);
    expect(bboxAreaDeg2({ west: 170, south: -20, east: -170, north: -10 })).toBe(200);
  });
});

describe("derived series", () => {
  const runRow = { id: "11111111-1111-4111-8111-111111111111", createdAt: new Date("2026-01-01T00:00:00Z"), startedAt: new Date("2026-01-01T00:00:01Z") };
  const sel = SelectionSchema.parse({ region: { bbox: colombia, name: "Colombia", source: "named" }, start: "2001-01", end: "2012-12", variables: ["merra2.TS", "merra2.T2M"], derived: ["derived.TS-T2M"] });
  const samples = months("2001-01", 144).map((month, i) => ({
    runId: runRow.id,
    collection: "M2TMNXSLV",
    month,
    status: "ok" as const,
    granuleId: `G${month}`,
    granuleTitle: `MERRA2.${month}.nc4`,
    opendapUrl: `https://opendap.earthdata.nasa.gov/granules/${month}`,
    // TS warms 0.02 K per month faster than T2M, so TS − T2M rises 2.4 K per decade.
    values: [
      { key: "merra2.TS", mean: 300 + i * 0.03, validCells: 100, totalCells: 100 },
      { key: "merra2.T2M", mean: 299 + i * 0.01, validCells: 100, totalCells: 100 },
    ],
    bytes: 1000,
    durationMs: 1000,
    attempts: 1,
    error: null,
    fetchedAt: new Date("2026-01-01T00:01:00Z"),
  }));

  it("validates derived series against the selected variables", () => {
    expect(SelectionSchema.safeParse({ ...sel, derived: ["derived.T2M-T2MDEW"] }).success).toBe(false);
    expect(SelectionSchema.safeParse({ ...sel, derived: ["derived.unknown"] }).success).toBe(false);
    const older: Record<string, unknown> = { ...sel };
    delete older.derived;
    expect(SelectionSchema.parse(older).derived).toBeUndefined();
  });

  it("analyzes the difference like a variable, with its formula as provenance", () => {
    const result = buildResult(runRow as never, sel, samples as never, { analysisStart: Date.now(), invocationStart: Date.now(), concurrency: 6, invocations: 1 });
    const derived = result.variables.find((v) => v.key === "derived.TS-T2M");
    expect(derived).toBeDefined();
    expect(derived!.dapName).toBe("TS − T2M");
    expect(derived!.analysis.units).toBe("°C");
    expect(derived!.analysis.monthly[0]!.value).toBeCloseTo(1, 9);
    expect(derived!.analysis.trend.status).toBe("ok");
    if (derived!.analysis.trend.status === "ok") expect(derived!.analysis.trend.slopePerDecade).toBeCloseTo(2.4, 6);
    expect(result.variables.map((v) => v.key)).toEqual(["merra2.TS", "merra2.T2M", "derived.TS-T2M"]);
  });
});
