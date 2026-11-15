/**
 * Real connector status for every source. Each probe makes at most one or two
 * short requests and, where a value can be read synchronously, reads one real
 * value (a small OPeNDAP subset, one NOAA station month). Asynchronous
 * services (Copernicus CDS, Harmony/Giovanni) are probed for access only; their
 * "Verified live" state comes from the last real value a run obtained, stored
 * in connector_checks. Results are cached for 5 minutes per instance.
 */
import { COLLECTIONS, getVariable } from "@/src/catalog";
import type { BBox } from "@/src/catalog/regions";
import type { ConnectorCheck, RunStore } from "@/src/db/store";
import { getRunStore } from "@/src/db/store";
import { config } from "@/src/lib/env";
import { errorMessage } from "@/src/lib/log";
import { parseJson, parseText, requestWithPolicy } from "@/src/lib/http";
import { CMR_SEARCH, pickOpendapUrl } from "./cmr";
import { readGranule, planWindow } from "./gridded";
import { CDO } from "./noaa";
import { POLICIES } from "./policies";

export type ConnectorState = "verified_live" | "reachable" | "configured" | "pending" | "error";

export interface ConnectorValue {
  value: number;
  units: string;
  label: string;
  checkedAt: string;
  runId: string | null;
  source: "probe" | "run";
}

export interface ConnectorStatus {
  id: string;
  name: string;
  role: string;
  state: ConnectorState;
  detail: string;
  latestData?: string;
  latencyMs?: number;
  checkedAt: string;
  /** The latest real value this connector returned (this probe, or a run). */
  lastValue?: ConnectorValue;
}

/** A run's value counts as current verification for this long. */
export const RUN_VALUE_FRESH_MS = 7 * 24 * 3600 * 1000;

let cache: { at: number; value: ConnectorStatus[] } | null = null;

const BOGOTA_BOX: BBox = { west: -75, south: 4, east: -73, north: 6 };
const PACIFIC_BOX: BBox = { west: -81, south: 2, east: -78, north: 7 };

interface CmrEntry {
  title: string;
  time_start: string;
  links?: Array<{ rel?: string; href: string }>;
}

async function latestGranule(conceptId: string, titleFilter?: string): Promise<CmrEntry | undefined> {
  const params = new URLSearchParams({ collection_concept_id: conceptId, sort_key: "-start_date", page_size: "1" });
  if (titleFilter) {
    params.set("readable_granule_name[]", `*${titleFilter}*`);
    params.set("options[readable_granule_name][pattern]", "true");
  }
  const latest = await requestWithPolicy(`${CMR_SEARCH}/granules.json?${params.toString()}`, {}, POLICIES.statusProbe, parseJson<{ feed?: { entry?: CmrEntry[] } }>);
  return latest.value.feed?.entry?.[0];
}

function fromCheck(check: ConnectorCheck | undefined): ConnectorValue | undefined {
  if (!check || !check.ok || check.value === null) return undefined;
  return { value: check.value, units: check.units ?? "", label: check.label ?? "", checkedAt: check.checkedAt.toISOString(), runId: check.runId, source: (check.detail?.source as "probe" | "run" | undefined) ?? (check.runId ? "run" : "probe") };
}

async function remember(store: RunStore | null, id: string, value: ConnectorValue, detail: Record<string, unknown>): Promise<void> {
  await store?.recordConnectorCheck({ connector: id, checkedAt: new Date(value.checkedAt), ok: true, value: value.value, units: value.units, label: value.label, detail: { ...detail, source: "probe" }, runId: null }).catch(() => undefined);
}

/** CMR latest granule plus one small authenticated OPeNDAP subset of a catalog variable (a real value). */
async function probeGridded(id: string, name: string, shortName: string, variableKey: string, box: BBox, boxLabel: string, store: RunStore | null): Promise<ConnectorStatus> {
  const started = Date.now();
  const collection = COLLECTIONS[shortName]!;
  const variable = getVariable(variableKey)!;
  const checkedAt = new Date().toISOString();
  const role = "Live connector (in use)";
  try {
    const entry = await latestGranule(collection.conceptId, collection.granuleTitleFilter);
    if (!entry) return { id, name, role, state: "error", detail: "CMR returned no granules", checkedAt };
    const opendap = pickOpendapUrl(entry.links);
    if (!config.earthdataToken || !opendap) {
      return { id, name, role, state: "reachable", detail: config.earthdataToken ? "Granule has no OPeNDAP link" : "EARTHDATA_TOKEN not configured", latestData: entry.time_start.slice(0, 7), checkedAt };
    }
    const read = await readGranule(opendap, collection, [variable], planWindow(collection, box), { token: config.earthdataToken, policy: POLICIES.statusProbe });
    const mean = read.values[0]?.mean;
    if (mean === null || mean === undefined) throw new Error(`no valid ${variable.dapName} cell in the probe box`);
    const month = entry.time_start.slice(0, 7);
    const value: ConnectorValue = { value: mean * variable.display.scale + variable.display.offset, units: variable.display.units, label: `${variable.name.en} · ${boxLabel} · ${month}`, checkedAt, runId: null, source: "probe" };
    await remember(store, collection.source, value, { granule: entry.title, bytes: read.bytes });
    return {
      id, name, role, state: "verified_live",
      detail: `CMR and authenticated OPeNDAP answered; a real ${variable.dapName} value was read from the latest granule (${read.bytes.toLocaleString("en-US")} bytes).`,
      latestData: month, latencyMs: Date.now() - started, checkedAt, lastValue: value,
    };
  } catch (error) {
    return { id, name, role, state: "error", detail: errorMessage(error).slice(0, 200), latencyMs: Date.now() - started, checkedAt };
  }
}

/** SeaWiFS: OPeNDAP subset when OB.DAAC allows it; otherwise the signed-link check and the last run value. */
async function probeSeawifs(store: RunStore | null, previous: ConnectorValue | undefined): Promise<ConnectorStatus> {
  const live = await probeGridded("seawifs", "NASA SeaWiFS chlorophyll-a (SeaWiFS_L3m_CHL 2022.0, OB.DAAC)", "SeaWiFS_L3m_CHL", "seawifs.chlor_a", PACIFIC_BOX, "Colombian Pacific", store);
  if (live.state === "verified_live") return live;
  const fresh = previous && Date.now() - Date.parse(previous.checkedAt) < RUN_VALUE_FRESH_MS ? previous : undefined;
  return {
    ...live,
    state: fresh ? "verified_live" : live.state === "error" ? "reachable" : live.state,
    detail: `OB.DAAC OPeNDAP did not answer the probe (${live.detail.slice(0, 120)}); runs fall back to the cloud files (at most 12 months per run).${fresh ? " Verified by the last run's real value." : ""}`,
    lastValue: fresh ?? previous,
  };
}

async function probeNoaa(store: RunStore | null): Promise<ConnectorStatus> {
  const checkedAt = new Date().toISOString();
  const base = { id: "noaa", name: "NOAA Climate Data Online (GSOM stations)", role: "Live connector (in use)" };
  if (!config.noaaToken) return { ...base, state: "pending", detail: "NOAA_CDO_TOKEN not configured.", checkedAt };
  const started = Date.now();
  const year = new Date().getUTCFullYear() - 1;
  const station = "GHCND:USW00023062";
  try {
    const url = `${CDO}/data?datasetid=GSOM&stationid=${encodeURIComponent(station)}&datatypeid=TAVG&startdate=${year}-01-01&enddate=${year}-12-31&units=metric&limit=12`;
    const page = await requestWithPolicy(url, { headers: { token: config.noaaToken } }, POLICIES.statusProbe, parseJson<{ results?: Array<{ date: string; value: number }> }>);
    const last = page.value.results?.at(-1);
    if (!last) return { ...base, state: "reachable", detail: "Token accepted; the reference station returned no records.", latencyMs: Date.now() - started, checkedAt };
    const value: ConnectorValue = { value: last.value, units: "°C", label: `Average temperature · Denver Central Park (${station}) · ${last.date.slice(0, 7)}`, checkedAt, runId: null, source: "probe" };
    await remember(store, "noaa", value, { station });
    return { ...base, state: "verified_live", detail: "Token accepted; one real monthly station observation was read (units=metric).", latestData: last.date.slice(0, 7), latencyMs: Date.now() - started, checkedAt, lastValue: value };
  } catch (error) {
    return { ...base, state: "error", detail: `CDO check failed: ${errorMessage(error).slice(0, 160)}`, latencyMs: Date.now() - started, checkedAt };
  }
}

/** Asynchronous services: access is probed now; "Verified live" needs a real value from a recent run. */
function asyncState(reachable: boolean, previous: ConnectorValue | undefined): { state: ConnectorState; lastValue?: ConnectorValue; fresh: boolean } {
  const fresh = Boolean(previous && Date.now() - Date.parse(previous.checkedAt) < RUN_VALUE_FRESH_MS);
  return { state: reachable ? (fresh ? "verified_live" : "reachable") : "error", lastValue: previous, fresh };
}

async function probeCds(previous: ConnectorValue | undefined): Promise<ConnectorStatus> {
  const checkedAt = new Date().toISOString();
  const base = { id: "era5", name: "Copernicus ERA5 monthly (CDS)", role: "Live connector (asynchronous jobs)" };
  if (!config.cdsKey) return { ...base, state: "pending", detail: "CDSAPI_KEY not configured.", checkedAt };
  const started = Date.now();
  try {
    const url = `${config.cdsUrl.replace(/\/$/, "")}/profiles/v1/account/licences`;
    const licences = await requestWithPolicy(url, { headers: { "PRIVATE-TOKEN": config.cdsKey } }, POLICIES.statusProbe, parseText);
    const accepted = (licences.value.match(/"id"\s*:\s*"([^"]+)"/g) ?? []).length;
    const s = asyncState(true, previous);
    return {
      ...base, state: s.state, latencyMs: Date.now() - started, checkedAt, lastValue: s.lastValue,
      detail: `CDS account answered (${accepted} licences accepted). Runs submit one retrieve job each and check it on later polls.${s.fresh ? " Verified by the last run's real value." : " No run has returned a value in the last 7 days."}`,
    };
  } catch (error) {
    return { ...base, state: "error", detail: `CDS account check failed: ${errorMessage(error).slice(0, 160)}`, latencyMs: Date.now() - started, checkedAt, lastValue: previous };
  }
}

async function probeHarmony(previous: ConnectorValue | undefined): Promise<ConnectorStatus> {
  const checkedAt = new Date().toISOString();
  const base = { id: "giovanni", name: "NASA Giovanni area averages (via Harmony)", role: "Live connector (asynchronous jobs)" };
  if (!config.earthdataToken) return { ...base, state: "pending", detail: "EARTHDATA_TOKEN not configured.", checkedAt };
  const started = Date.now();
  try {
    const caps = await requestWithPolicy(`https://harmony.earthdata.nasa.gov/capabilities?collectionId=${COLLECTIONS.GLDAS_NOAH025_M!.conceptId}`, { headers: { Authorization: `Bearer ${config.earthdataToken}` } }, POLICIES.statusProbe, parseText);
    const giovanni = /giovanni/i.test(caps.value);
    const s = asyncState(giovanni, previous);
    return {
      ...base, state: s.state, latencyMs: Date.now() - started, checkedAt, lastValue: s.lastValue,
      detail: `${giovanni ? "Harmony lists the Giovanni services for GLDAS" : "Harmony answered without Giovanni services"}; runs submit one job per variable.${s.fresh ? " Verified by the last run's real value." : " No run has returned a value in the last 7 days."}`,
    };
  } catch (error) {
    return { ...base, state: "error", detail: `Harmony check failed: ${errorMessage(error).slice(0, 160)}`, latencyMs: Date.now() - started, checkedAt, lastValue: previous };
  }
}

export async function connectorStatus(): Promise<ConnectorStatus[]> {
  if (cache && Date.now() - cache.at < 300_000) return cache.value;
  let store: RunStore | null = null;
  let checks = new Map<string, ConnectorValue>();
  try {
    store = getRunStore();
    checks = new Map((await store.listConnectorChecks()).flatMap((c) => {
      const v = fromCheck(c);
      return v ? [[c.connector, v] as const] : [];
    }));
  } catch {
    store = null;
  }
  const value = await Promise.all([
    probeGridded("merra2", "NASA MERRA-2 monthly (M2TMNX* v5.12.4)", "M2TMNXSLV", "merra2.T2M", BOGOTA_BOX, "Bogotá area", store),
    probeGridded("imerg", "NASA GPM IMERG monthly V07", "GPM_3IMERGM", "imerg.precipitation", BOGOTA_BOX, "Bogotá area", store),
    probeGridded("gldas", "NASA GLDAS Noah monthly 0.25° (GLDAS_NOAH025_M 2.1)", "GLDAS_NOAH025_M", "gldas.SoilMoi0_10cm_inst", BOGOTA_BOX, "Bogotá area", store),
    probeSeawifs(store, checks.get("seawifs")),
    probeCds(checks.get("era5")),
    probeNoaa(store),
    probeHarmony(checks.get("giovanni")),
  ]);
  cache = { at: Date.now(), value };
  return value;
}
