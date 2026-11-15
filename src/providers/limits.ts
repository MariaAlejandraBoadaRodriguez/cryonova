/**
 * Request-size limits shared by the server connectors and the browser plan
 * (pure functions and constants only: this module is bundled for the client).
 */
import type { BBox } from "@/src/catalog/regions";

/** OPeNDAP subsets are the normal OB.DAAC path; whole monthly files (~10.7 MB each) are a bounded fallback per run. */
export const OBDAAC_FILE_FALLBACK_MONTHS = 12;

/** NOAA CDO: stations read per run, and stations that may enter the regional mean. */
export const NOAA_MAX_CANDIDATES = 12;
export const NOAA_MAX_STATIONS = 8;

/** Months a station needs for a variable to enter the regional mean: a quarter of the period, at least 12 (or the whole period if shorter). */
export function minStationMonths(months: number): number {
  return Math.min(months, Math.max(Math.ceil(months / 4), 12));
}

const ERA5_NATIVE_STEP = 0.25;

/** ERA5 request grid: native 0.25°, coarsened so one CDS result stays below ~20 M values (and 12,000 cells per month). */
export function era5GridStep(bbox: BBox, months: number, variables: number, maxValues = 20_000_000, maxCells = 12_000): number {
  const width = bbox.west <= bbox.east ? bbox.east - bbox.west : bbox.east + 360 - bbox.west;
  const height = bbox.north - bbox.south;
  const native = (Math.floor(height / ERA5_NATIVE_STEP) + 1) * (Math.floor(width / ERA5_NATIVE_STEP) + 1);
  const cap = Math.max(400, Math.min(maxCells, Math.floor(maxValues / Math.max(1, months * variables))));
  return native <= cap ? ERA5_NATIVE_STEP : ERA5_NATIVE_STEP * Math.ceil(Math.sqrt(native / cap));
}
