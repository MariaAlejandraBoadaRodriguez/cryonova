/**
 * NOAA Climate Data Online (CDO) web services v2: Global Summary of the Month
 * (GSOM) station observations as point data.
 *
 * Station search: stations inside the area with the requested datatypes and a
 * period of record overlapping the selection, ranked by overlap x data
 * coverage. Observations: one request per station and window of at most ten
 * years (the CDO limit for monthly data), units=metric, paginated. The regional
 * series of each variable is the mean of the stations with at least a quarter
 * of the months; every station's own values are kept for the map and table.
 */
import type { BBox } from "@/src/catalog/regions";
import type { CatalogVariable } from "@/src/catalog/types";
import { lastDayOfMonth } from "@/src/providers/cmr";
import { parseJson, ProviderError, requestWithPolicy } from "@/src/lib/http";
import type { VariableMonthValue } from "./gridded";
import { minStationMonths, NOAA_MAX_CANDIDATES, NOAA_MAX_STATIONS } from "./limits";
import { POLICIES, withSignal } from "./policies";

export { minStationMonths };
import type { CheckOutcome, FetchedMonth, FetchOutcome, ProviderJobRow, RemoteConnector, RemoteContext, SubmitOutcome } from "./remote";

export const CDO = "https://www.ncei.noaa.gov/cdo-web/api/v2";
const HOST = "www.ncei.noaa.gov";
export const MAX_CANDIDATES = NOAA_MAX_CANDIDATES;
export const MAX_STATIONS = NOAA_MAX_STATIONS;
const PAGE = 1000;

export interface CdoStation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation?: number;
  mindate: string;
  maxdate: string;
  datacoverage: number;
}

export interface StationInfo {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number | null;
  mindate: string;
  maxdate: string;
  datacoverage: number;
}

interface CdoPage<T> {
  metadata?: { resultset?: { offset: number; count: number; limit: number } };
  results?: T[];
}

interface CdoRecord {
  date: string;
  datatype: string;
  station: string;
  value: number;
}

function token(ctx: RemoteContext): string {
  const value = ctx.credentials.noaaToken;
  if (!value) throw new ProviderError("unauthorized", "The NOAA CDO token is not configured on the server (NOAA_CDO_TOKEN).", HOST, 0);
  return value;
}

/** Search extents (south, west, north, east); a box crossing the antimeridian becomes two. */
export function extentsOf(bbox: BBox): string[] {
  const fmt = (s: number, w: number, n: number, e: number) => [s, w, n, e].map((x) => Number(x.toFixed(4))).join(",");
  return bbox.west <= bbox.east ? [fmt(bbox.south, bbox.west, bbox.north, bbox.east)] : [fmt(bbox.south, bbox.west, bbox.north, 180), fmt(bbox.south, -180, bbox.north, bbox.east)];
}

/** Share of the requested period inside the station's period of record (0–1). */
export function overlapFraction(station: Pick<CdoStation, "mindate" | "maxdate">, start: string, end: string): number {
  const from = Math.max(Date.parse(`${start}-01`), Date.parse(station.mindate));
  const to = Math.min(Date.parse(`${lastDayOfMonth(end)}`), Date.parse(station.maxdate));
  const span = Date.parse(lastDayOfMonth(end)) - Date.parse(`${start}-01`);
  return span > 0 && to > from ? Math.min(1, (to - from) / span) : 0;
}

export function rankStations(stations: CdoStation[], start: string, end: string, limit = MAX_CANDIDATES): StationInfo[] {
  const unique = new Map(stations.map((s) => [s.id, s]));
  return [...unique.values()]
    .map((s) => ({ s, score: overlapFraction(s, start, end) * (s.datacoverage ?? 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id))
    .slice(0, limit)
    .map(({ s }) => ({ id: s.id, name: s.name, lat: s.latitude, lon: s.longitude, elevation: typeof s.elevation === "number" ? s.elevation : null, mindate: s.mindate, maxdate: s.maxdate, datacoverage: s.datacoverage }));
}

/** Windows of at most ten years (CDO's limit for monthly datasets). */
export function tenYearWindows(start: string, end: string): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  let year = Number(start.slice(0, 4));
  let from = start;
  while (from <= end) {
    const to = `${year + 9}-12` < end ? `${year + 9}-12` : end;
    out.push({ start: from, end: to });
    year += 10;
    from = `${year}-01`;
  }
  return out;
}

export interface StationSeries {
  station: string;
  datatype: string;
  month: string;
  value: number;
}

/**
 * Combines per-station records into monthly values per variable. Stations with
 * at least a quarter of the months (minStationMonths) form the regional mean; a
 * month's mean needs at least half of those stations reporting. Every
 * station's own values are kept as point data either way.
 */
export function aggregateStations(records: StationSeries[], variables: CatalogVariable[], stations: StationInfo[], months: string[], maxStations = MAX_STATIONS): { months: FetchedMonth[]; used: Record<string, string[]> } {
  const values = new Map<string, number>();
  for (const r of records) values.set(`${r.station}|${r.datatype}|${r.month}`, r.value);
  const used: Record<string, string[]> = {};
  for (const variable of variables) {
    const counts = stations.map((s) => ({ id: s.id, n: months.filter((m) => values.has(`${s.id}|${variable.dapName}|${m}`)).length }));
    used[variable.key] = counts
      .filter((c) => c.n >= minStationMonths(months.length))
      .sort((a, b) => b.n - a.n)
      .slice(0, maxStations)
      .map((c) => c.id);
  }
  const out: FetchedMonth[] = months.map((month) => ({
    month,
    values: variables.map((variable): VariableMonthValue => {
      const ids = used[variable.key] ?? [];
      const reporting = ids.map((id) => values.get(`${id}|${variable.dapName}|${month}`)).filter((v): v is number => v !== undefined);
      const points = stations.flatMap((s) => {
        const v = values.get(`${s.id}|${variable.dapName}|${month}`);
        return v === undefined ? [] : [{ id: s.id, value: v }];
      });
      const enough = ids.length > 0 && reporting.length >= Math.max(1, Math.ceil(ids.length / 2));
      return { key: variable.key, mean: enough ? reporting.reduce((a, b) => a + b, 0) / reporting.length : null, validCells: reporting.length, totalCells: ids.length, points };
    }),
  }));
  return { months: out, used };
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next] as T;
      next += 1;
      await worker(item);
    }
  }));
}

export const noaaConnector: RemoteConnector = {
  provider: "noaa-cdo",
  jobKeys: () => ["stations"],

  async submit(ctx): Promise<SubmitOutcome> {
    const headers = { token: token(ctx), Accept: "application/json" };
    const datatypes = ctx.variables.map((v) => v.dapName);
    const found: CdoStation[] = [];
    const urls: string[] = [];
    for (const extent of extentsOf(ctx.bbox)) {
      const params = new URLSearchParams({ datasetid: ctx.collection.remote?.dataset ?? "GSOM", extent, startdate: `${ctx.start}-01`, enddate: lastDayOfMonth(ctx.end), limit: String(PAGE), sortfield: "datacoverage", sortorder: "desc" });
      for (const d of datatypes) params.append("datatypeid", d);
      const url = `${CDO}/stations?${params.toString()}`;
      urls.push(url);
      const page = await requestWithPolicy(url, { headers }, withSignal(POLICIES.noaaCdo, ctx.signal), parseJson<CdoPage<CdoStation>>, ctx.fetchImpl);
      found.push(...(page.value.results ?? []));
    }
    const stations = rankStations(found, ctx.start, ctx.end);
    return {
      jobRef: null,
      status: "successful",
      request: { urls },
      meta: { stations, found: found.length },
      message: stations.length > 0 ? `${found.length} stations found; ${stations.length} candidates selected` : "No NOAA GSOM station with these datatypes reports inside the area for this period",
    };
  },

  async check(_ctx, job): Promise<CheckOutcome> {
    return { status: job.status };
  },

  async fetch(ctx, job: ProviderJobRow): Promise<FetchOutcome> {
    const started = Date.now();
    const headers = { token: token(ctx), Accept: "application/json" };
    const stations = ((job.meta?.stations ?? []) as StationInfo[]).slice(0, MAX_CANDIDATES);
    const datatypes = ctx.variables.map((v) => v.dapName);
    const records: StationSeries[] = [];
    let bytes = 0;
    let attempts = 0;
    let example = "";
    const tasks = stations.flatMap((s) => tenYearWindows(ctx.start, ctx.end).map((w) => ({ s, w })));
    await pool(tasks, 2, async ({ s, w }) => {
      let offset = 1;
      for (let pageNo = 0; pageNo < 5; pageNo += 1) {
        const params = new URLSearchParams({ datasetid: ctx.collection.remote?.dataset ?? "GSOM", stationid: s.id, startdate: `${w.start}-01`, enddate: lastDayOfMonth(w.end), units: "metric", limit: String(PAGE), offset: String(offset) });
        for (const d of datatypes) params.append("datatypeid", d);
        const url = `${CDO}/data?${params.toString()}`;
        example ||= url;
        const page = await requestWithPolicy(url, { headers }, withSignal(POLICIES.noaaCdo, ctx.signal), async (r) => {
          const text = await r.text();
          bytes += text.length;
          return (text.trim() ? JSON.parse(text) : {}) as CdoPage<CdoRecord>;
        }, ctx.fetchImpl);
        attempts += page.attempts;
        for (const r of page.value.results ?? []) {
          if (datatypes.includes(r.datatype) && Number.isFinite(r.value)) records.push({ station: r.station, datatype: r.datatype, month: r.date.slice(0, 7), value: r.value });
        }
        const set = page.value.metadata?.resultset;
        if (!set || set.offset + set.limit > set.count) break;
        offset += PAGE;
      }
    });
    const { months, used } = aggregateStations(records, ctx.variables, stations, ctx.months);
    return {
      months,
      bytes,
      durationMs: Date.now() - started,
      attempts,
      exampleRequest: example,
      meta: { stations, used, records: records.length, requests: tasks.length },
    };
  },
};
