/**
 * Real connector status for the agreed sources. Integrated NASA sources are
 * probed live (CMR + authenticated OPeNDAP DDS of the latest granule); other
 * sources report credential and reachability checks or what is pending.
 * Results are cached for 5 minutes per instance to protect providers.
 */
import { COLLECTIONS } from "@/src/catalog";
import { config } from "@/src/lib/env";
import { errorMessage } from "@/src/lib/log";
import { parseJson, parseText, requestWithPolicy } from "@/src/lib/http";
import { CMR_SEARCH, pickOpendapUrl } from "./cmr";
import { POLICIES } from "./policies";

export type ConnectorState = "verified_live" | "reachable" | "configured" | "pending" | "error";

export interface ConnectorStatus {
  id: string;
  name: string;
  role: string;
  state: ConnectorState;
  detail: string;
  latestData?: string;
  latencyMs?: number;
  checkedAt: string;
}

let cache: { at: number; value: ConnectorStatus[] } | null = null;

async function probeGridded(id: string, name: string, shortName: string): Promise<ConnectorStatus> {
  const started = Date.now();
  const collection = COLLECTIONS[shortName]!;
  const checkedAt = new Date().toISOString();
  try {
    const url = `${CMR_SEARCH}/granules.json?collection_concept_id=${collection.conceptId}&sort_key=-start_date&page_size=1`;
    const latest = await requestWithPolicy(url, {}, POLICIES.statusProbe, parseJson<{ feed?: { entry?: Array<{ title: string; time_start: string; links?: Array<{ rel?: string; href: string }> }> } }>);
    const entry = latest.value.feed?.entry?.[0];
    if (!entry) return { id, name, role: "Live connector", state: "error", detail: "CMR returned no granules", checkedAt };
    const opendap = pickOpendapUrl(entry.links);
    if (!config.earthdataToken || !opendap) {
      return { id, name, role: "Live connector", state: "reachable", detail: config.earthdataToken ? "Granule has no OPeNDAP link" : "EARTHDATA_TOKEN not configured", latestData: entry.time_start.slice(0, 7), checkedAt };
    }
    const dds = await requestWithPolicy(`${opendap}.dds`, { headers: { Authorization: `Bearer ${config.earthdataToken}` } }, POLICIES.statusProbe, parseText);
    const fields = (dds.value.match(/Grid \{/g) ?? []).length;
    return {
      id,
      name,
      role: "Live connector (in use)",
      state: "verified_live",
      detail: `CMR and authenticated OPeNDAP answered; latest granule ${entry.title.split(":").pop()} exposes ${fields} grid fields.`,
      latestData: entry.time_start.slice(0, 7),
      latencyMs: Date.now() - started,
      checkedAt,
    };
  } catch (error) {
    return { id, name, role: "Live connector", state: "error", detail: errorMessage(error).slice(0, 200), latencyMs: Date.now() - started, checkedAt };
  }
}

async function probeNoaa(): Promise<ConnectorStatus> {
  const checkedAt = new Date().toISOString();
  const base = { id: "noaa-cdo", name: "NOAA Climate Data Online (stations)", role: "Agreed source, connector pending" };
  if (!config.noaaToken) return { ...base, state: "pending", detail: "NOAA_CDO_TOKEN not configured.", checkedAt };
  const started = Date.now();
  try {
    await requestWithPolicy("https://www.ncei.noaa.gov/cdo-web/api/v2/datasets?limit=1", { headers: { token: config.noaaToken } }, POLICIES.statusProbe, parseJson);
    return { ...base, state: "configured", detail: "Token accepted by the CDO web services; station search and observation reads are not integrated in the app yet.", latencyMs: Date.now() - started, checkedAt };
  } catch (error) {
    return { ...base, state: "error", detail: `CDO token check failed: ${errorMessage(error).slice(0, 160)}`, latencyMs: Date.now() - started, checkedAt };
  }
}

async function probeCds(): Promise<ConnectorStatus> {
  const checkedAt = new Date().toISOString();
  const base = { id: "era5-cds", name: "Copernicus ERA5 monthly (CDS)", role: "Agreed source, connector pending" };
  if (!config.cdsKey) return { ...base, state: "pending", detail: "CDSAPI_KEY not configured.", checkedAt };
  const started = Date.now();
  try {
    await requestWithPolicy(`${config.cdsUrl.replace(/\/$/, "")}/catalogue/v1/collections/reanalysis-era5-single-levels-monthly-means`, {}, POLICIES.statusProbe, parseJson);
    return { ...base, state: "configured", detail: "CDS catalogue reachable and credentials configured; the asynchronous retrieve job is not integrated in the app yet (needs a durable runner and licence acceptance by the administrator).", latencyMs: Date.now() - started, checkedAt };
  } catch (error) {
    return { ...base, state: "error", detail: `CDS catalogue check failed: ${errorMessage(error).slice(0, 160)}`, latencyMs: Date.now() - started, checkedAt };
  }
}

export async function connectorStatus(): Promise<ConnectorStatus[]> {
  if (cache && Date.now() - cache.at < 300_000) return cache.value;
  const checkedAt = new Date().toISOString();
  const value = await Promise.all([
    probeGridded("merra2", "NASA MERRA-2 monthly (M2TMNX* v5.12.4)", "M2TMNXSLV"),
    probeGridded("imerg", "NASA GPM IMERG monthly V07", "GPM_3IMERGM"),
    probeCds(),
    probeNoaa(),
    Promise.resolve<ConnectorStatus>({ id: "giovanni", name: "NASA Giovanni", role: "Agreed source, pending", state: "pending", detail: "Variables are reachable through their source collections (as MERRA-2 and IMERG are here); a Harmony-based path for other collections is not integrated yet.", checkedAt }),
    Promise.resolve<ConnectorStatus>({ id: "gldas", name: "NASA Hydrology (GLDAS monthly)", role: "Agreed source, pending", state: "pending", detail: "hydro1.gesdisc host verified reachable; GLDAS collection not yet added to the catalog (same OPeNDAP path as MERRA-2).", checkedAt }),
    Promise.resolve<ConnectorStatus>({ id: "seawifs", name: "NASA SeaWiFS chlorophyll (SeaWiFS_L3m_CHL)", role: "Agreed source, pending", state: "pending", detail: "oceandata.sci.gsfc.nasa.gov verified reachable; chlor_a reader not integrated yet (mission data 1997-2010).", checkedAt }),
  ]);
  cache = { at: Date.now(), value };
  return value;
}
