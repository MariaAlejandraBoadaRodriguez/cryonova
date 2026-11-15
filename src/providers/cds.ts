/**
 * Copernicus Climate Data Store (CDS) connector for ERA5 monthly means.
 *
 * One retrieve job per run covers every selected ERA5 variable, the area and
 * the period (years x months). The job is submitted once, its id is stored in
 * Neon, and later invocations check it with one short request each. When CDS
 * reports it successful, the result (a NetCDF-4 file, or a ZIP of NetCDF files
 * when step types differ) is fetched from the signed object-store link without
 * credentials, decoded with h5wasm and reduced to cosine-latitude weighted
 * regional means. Large areas are requested on a coarser grid so one result
 * stays small.
 */
import type { BBox } from "@/src/catalog/regions";
import type { CatalogVariable } from "@/src/catalog/types";
import { parseBytes, parseJson, ProviderError, requestWithPolicy } from "@/src/lib/http";
import type { VariableMonthValue } from "./gridded";
import { withNetcdf } from "./netcdf";
import { POLICIES, withSignal } from "./policies";
import {
  type CheckOutcome,
  type FetchedMonth,
  type FetchOutcome,
  lonInBox,
  type ProviderJobRow,
  type ProviderJobStatus,
  type RemoteConnector,
  type RemoteContext,
  type SubmitOutcome,
} from "./remote";
import { era5GridStep } from "./limits";
import { isZip, unzip } from "./zip";

export { era5GridStep };

const NATIVE_STEP = 0.25;
const DEFAULT_CDS_URL = "https://cds.climate.copernicus.eu/api";

export function cdsBase(url?: string): string {
  return (url || DEFAULT_CDS_URL).replace(/\/+$/, "");
}

export function cdsInputs(ctx: Pick<RemoteContext, "variables" | "bbox" | "months">) {
  const years = [...new Set(ctx.months.map((m) => m.slice(0, 4)))].sort();
  const months = [...new Set(ctx.months.map((m) => m.slice(5, 7)))].sort();
  const step = era5GridStep(ctx.bbox, ctx.months.length, ctx.variables.length);
  const { north, west, south, east } = ctx.bbox;
  return {
    step,
    inputs: {
      product_type: ["monthly_averaged_reanalysis"],
      variable: ctx.variables.map((v) => v.requestName ?? v.dapName),
      year: years,
      month: months,
      time: ["00:00"],
      area: [north, west, south, east],
      data_format: "netcdf",
      download_format: "unarchived",
      ...(step > NATIVE_STEP ? { grid: [step, step] } : {}),
    },
  };
}

export function mapCdsStatus(status: string | undefined): ProviderJobStatus {
  switch (status) {
    case "accepted":
      return "accepted";
    case "running":
      return "running";
    case "successful":
      return "successful";
    case "failed":
    case "dismissed":
    case "deleted":
      return "failed";
    default:
      return "running";
  }
}

function timeToUnixSeconds(value: number, units: string): number {
  const match = /^(seconds|minutes|hours|days) since (\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/.exec(units.trim());
  if (!match) return value;
  const base = Date.parse(`${match[2]}T${match[3] ?? "00:00:00"}Z`) / 1000;
  const factor = { seconds: 1, minutes: 60, hours: 3600, days: 86400 }[match[1] as "seconds"];
  return base + value * factor;
}

export interface Era5Decoded {
  months: FetchedMonth[];
  units: Record<string, string | null>;
  cells: number;
}

/** Cosine-latitude weighted means inside the box, per month and variable, from CDS NetCDF files. */
export async function decodeEra5(files: Uint8Array[], variables: CatalogVariable[], bbox: BBox, months: string[]): Promise<Era5Decoded> {
  const wanted = new Set(months);
  const byMonth = new Map<string, VariableMonthValue[]>();
  const units: Record<string, string | null> = {};
  let cells = 0;
  for (const bytes of files) {
    await withNetcdf(bytes, (nc) => {
      const present = variables.filter((v) => nc.has(v.dapName));
      if (present.length === 0) return;
      const lats = nc.read("latitude");
      const lons = nc.read("longitude");
      const timeName = nc.has("valid_time") ? "valid_time" : "time";
      const timeUnits = nc.text(timeName, "units") ?? "seconds since 1970-01-01";
      const times = Array.from(nc.read(timeName), (t) => timeToUnixSeconds(t, timeUnits));
      const latIn = Array.from(lats, (lat) => lat >= bbox.south - 1e-9 && lat <= bbox.north + 1e-9);
      const lonIn = Array.from(lons, (lon) => lonInBox(lon, bbox));
      const weights = Array.from(lats, (lat) => Math.cos((lat * Math.PI) / 180));
      cells = Math.max(cells, latIn.filter(Boolean).length * lonIn.filter(Boolean).length);
      for (const variable of present) {
        const declared = nc.text(variable.dapName, "units");
        units[variable.key] = declared;
        if (declared && declared !== variable.providerUnits) {
          throw new ProviderError("bad_response", `ERA5 ${variable.dapName} arrived in ${declared}, the catalog expects ${variable.providerUnits}`, "cds.climate.copernicus.eu", 1);
        }
        const shape = nc.shape(variable.dapName);
        const nLon = shape[shape.length - 1] as number;
        const nLat = shape[shape.length - 2] as number;
        const nTime = shape.length >= 3 ? (shape[shape.length - 3] as number) : 1;
        if (nLat !== lats.length || nLon !== lons.length) throw new ProviderError("bad_response", `ERA5 ${variable.dapName} has an unexpected shape ${shape.join("x")}`, "cds.climate.copernicus.eu", 1);
        const data = nc.read(variable.dapName);
        for (let t = 0; t < nTime; t += 1) {
          const month = new Date((times[t] ?? 0) * 1000).toISOString().slice(0, 7);
          if (!wanted.has(month)) continue;
          let sumW = 0;
          let sumWV = 0;
          let valid = 0;
          let total = 0;
          for (let j = 0; j < nLat; j += 1) {
            if (!latIn[j]) continue;
            for (let i = 0; i < nLon; i += 1) {
              if (!lonIn[i]) continue;
              total += 1;
              const value = data[t * nLat * nLon + j * nLon + i] as number;
              if (!Number.isFinite(value)) continue;
              sumW += weights[j] as number;
              sumWV += (weights[j] as number) * value;
              valid += 1;
            }
          }
          const list = byMonth.get(month) ?? [];
          list.push({ key: variable.key, mean: valid > 0 && sumW > 0 ? sumWV / sumW : null, validCells: valid, totalCells: total });
          byMonth.set(month, list);
        }
      }
    });
  }
  return { months: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, values]) => ({ month, values })), units, cells };
}

function headers(key: string): Record<string, string> {
  return { "PRIVATE-TOKEN": key, Accept: "application/json" };
}

function requireKey(ctx: RemoteContext): string {
  const key = ctx.credentials.cdsKey;
  if (!key) throw new ProviderError("unauthorized", "The Copernicus CDS key is not configured on the server (CDSAPI_KEY).", "cds.climate.copernicus.eu", 0);
  return key;
}

export const cdsConnector: RemoteConnector = {
  provider: "cds",
  jobKeys: () => ["all"],

  async submit(ctx): Promise<SubmitOutcome> {
    const key = requireKey(ctx);
    const dataset = ctx.collection.remote?.dataset ?? "reanalysis-era5-single-levels-monthly-means";
    const { inputs, step } = cdsInputs(ctx);
    const url = `${cdsBase(ctx.credentials.cdsUrl)}/retrieve/v1/processes/${dataset}/execution`;
    // POST is not idempotent: no automatic retry, so a timeout never creates a second job.
    const response = await requestWithPolicy(
      url,
      { method: "POST", headers: { ...headers(key), "Content-Type": "application/json" }, body: JSON.stringify({ inputs }) },
      withSignal({ ...POLICIES.jobSubmit, retries: 0 }, ctx.signal),
      parseJson<{ jobID?: string; status?: string }>,
      ctx.fetchImpl,
    );
    if (!response.value.jobID) throw new ProviderError("bad_response", "CDS accepted the request but returned no job id", new URL(url).host, response.attempts, response.status);
    return { jobRef: response.value.jobID, status: mapCdsStatus(response.value.status), request: { url, dataset, inputs }, meta: { gridStep: step }, message: `CDS job ${response.value.status ?? "submitted"}` };
  },

  async check(ctx, job): Promise<CheckOutcome> {
    const key = requireKey(ctx);
    const base = cdsBase(ctx.credentials.cdsUrl);
    const response = await requestWithPolicy(`${base}/retrieve/v1/jobs/${job.jobRef}`, { headers: headers(key) }, withSignal(POLICIES.jobCheck, ctx.signal), parseJson<{ status?: string; started?: string | null; finished?: string | null }>, ctx.fetchImpl);
    const status = mapCdsStatus(response.value.status);
    let message = `CDS job ${response.value.status ?? "unknown"}`;
    if (status === "failed") {
      // The results endpoint describes why a job failed.
      try {
        const detail = await requestWithPolicy(`${base}/retrieve/v1/jobs/${job.jobRef}/results`, { headers: headers(key) }, withSignal(POLICIES.jobCheck, ctx.signal), parseJson<{ title?: string; detail?: string }>, ctx.fetchImpl, { accept: (s) => s >= 400 && s < 500 });
        message = `CDS job failed: ${[detail.value.title, detail.value.detail].filter(Boolean).join(" — ").slice(0, 300) || "no detail"}`;
      } catch {
        message = "CDS job failed (no detail available)";
      }
    }
    return { status, message, meta: { started: response.value.started ?? null, finished: response.value.finished ?? null } };
  },

  async fetch(ctx, job: ProviderJobRow): Promise<FetchOutcome> {
    const key = requireKey(ctx);
    const base = cdsBase(ctx.credentials.cdsUrl);
    const started = Date.now();
    const results = await requestWithPolicy(`${base}/retrieve/v1/jobs/${job.jobRef}/results`, { headers: headers(key) }, withSignal(POLICIES.jobCheck, ctx.signal), parseJson<{ asset?: { value?: { href?: string } } }>, ctx.fetchImpl);
    const href = results.value.asset?.value?.href;
    if (!href) throw new ProviderError("bad_response", "CDS job has no result link", new URL(base).host, results.attempts);
    // Signed object-store link: fetched without the CDS key.
    const file = await requestWithPolicy(href, {}, withSignal(POLICIES.fileDownload, ctx.signal), parseBytes, ctx.fetchImpl);
    const files = isZip(file.value) ? unzip(file.value).filter((e) => e.name.endsWith(".nc")).map((e) => e.data) : [file.value];
    const decoded = await decodeEra5(files, ctx.variables, ctx.bbox, ctx.months);
    return {
      months: decoded.months,
      bytes: file.value.byteLength,
      durationMs: Date.now() - started,
      attempts: results.attempts + file.attempts,
      exampleRequest: `POST ${base}/retrieve/v1/processes/${ctx.collection.remote?.dataset}/execution → job ${job.jobRef}`,
      meta: { resultHost: new URL(href).host, files: files.length, units: decoded.units, cellsPerMonth: decoded.cells },
    };
  },
};
