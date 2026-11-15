/**
 * Reads one month of one or more variables from a gridded collection through
 * Cloud OPeNDAP and reduces each to a cosine-latitude weighted regional mean,
 * the method used in the Databricks reference notebooks.
 */
import type { BBox } from "@/src/catalog/regions";
import type { CatalogVariable, CollectionSpec } from "@/src/catalog/types";
import { parseBytes, ProviderError, requestWithPolicy, type RequestPolicy } from "@/src/lib/http";
import { decodeDods, DodsDecodeError, type DecodedArray } from "./opendap/dods";
import { type GridWindow, hyperslab, type IndexRange, windowForBBox } from "./grid";

export interface VariableMonthValue {
  key: string;
  /** Weighted mean in provider units, or null when no valid cell was returned. */
  mean: number | null;
  /** Valid grid cells (or reporting stations) behind the mean. */
  validCells: number;
  totalCells: number;
  /** Station data only: each reporting station's value in provider units. */
  points?: Array<{ id: string; value: number }>;
}

export interface GranuleRead {
  values: VariableMonthValue[];
  /** OPeNDAP URLs requested, without credentials. */
  urls: string[];
  bytes: number;
  durationMs: number;
  attempts: number;
}

function encodeProjection(text: string): string {
  return text.replace(/\[/g, "%5B").replace(/\]/g, "%5D").replace(/\//g, "%2F");
}

export function buildConstraint(collection: CollectionSpec, variables: CatalogVariable[], window: GridWindow, lonPiece: IndexRange): string {
  const { grid } = collection;
  const latSlab = hyperslab(window.lat);
  const lonSlab = hyperslab(lonPiece);
  const spatial = grid.order === "lat-lon" ? `${latSlab}${lonSlab}` : `${lonSlab}${latSlab}`;
  const time = grid.hasTime === false ? "" : "[0:0]";
  const projections = variables.map((v) => `${v.dapName}${time}${spatial}`);
  projections.push(`${grid.latName}${latSlab}`, `${grid.lonName}${lonSlab}`);
  return projections.map(encodeProjection).join(",");
}

export function isValidValue(value: number, fill: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (Math.abs(value) >= 1e14) return false;
  return Math.abs(value - fill) > Math.abs(fill) * 1e-6;
}

export interface WeightedSums {
  sumW: number;
  sumWV: number;
  valid: number;
  total: number;
}

export function weightedSums(values: Float64Array, lats: Float64Array, nLon: number, order: "lat-lon" | "lon-lat", fill: number): WeightedSums {
  const nLat = lats.length;
  if (values.length !== nLat * nLon) throw new DodsDecodeError(`Array size ${values.length} does not match ${nLat}x${nLon}`);
  let sumW = 0;
  let sumWV = 0;
  let valid = 0;
  for (let j = 0; j < nLat; j += 1) {
    const weight = Math.cos(((lats[j] as number) * Math.PI) / 180);
    for (let i = 0; i < nLon; i += 1) {
      const value = (order === "lat-lon" ? values[j * nLon + i] : values[i * nLat + j]) as number;
      if (isValidValue(value, fill)) {
        sumW += weight;
        sumWV += weight * value;
        valid += 1;
      }
    }
  }
  return { sumW, sumWV, valid, total: nLat * nLon };
}

function coordinate(arrays: Map<string, DecodedArray>, gridName: string, shortName: string, topLevel: string): Float64Array {
  const found = arrays.get(`${gridName}.${shortName}`) ?? arrays.get(topLevel);
  if (!found) throw new DodsDecodeError(`Coordinate ${shortName} missing for ${gridName}`);
  return found.values;
}

export interface ReadOptions {
  token: string;
  policy: RequestPolicy;
  maxCells?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

export function planWindow(collection: CollectionSpec, bbox: BBox, maxCells = 12_000): GridWindow {
  return windowForBBox(collection.grid, bbox, maxCells);
}

export async function readGranule(
  opendapUrl: string,
  collection: CollectionSpec,
  variables: CatalogVariable[],
  window: GridWindow,
  options: ReadOptions,
): Promise<GranuleRead> {
  const started = Date.now();
  const sums = new Map<string, WeightedSums>(variables.map((v) => [v.key, { sumW: 0, sumWV: 0, valid: 0, total: 0 }]));
  const urls: string[] = [];
  let bytes = 0;
  let attempts = 0;
  const latShort = collection.grid.latName.split("/").pop() as string;
  const lonShort = collection.grid.lonName.split("/").pop() as string;

  for (const lonPiece of window.lon) {
    const url = `${opendapUrl}.dods?${buildConstraint(collection, variables, window, lonPiece)}`;
    urls.push(url);
    const result = await requestWithPolicy(
      url,
      { headers: { Authorization: `Bearer ${options.token}`, Accept: "application/octet-stream" } },
      options.policy,
      parseBytes,
      options.fetchImpl,
    );
    attempts += result.attempts;
    bytes += result.value.byteLength;
    let decoded: ReturnType<typeof decodeDods>;
    try {
      decoded = decodeDods(result.value);
    } catch (error) {
      throw new ProviderError("bad_response", error instanceof Error ? error.message : String(error), new URL(url).host, result.attempts);
    }
    for (const variable of variables) {
      const array = decoded.arrays.get(variable.dapName);
      if (!array) throw new ProviderError("bad_response", `Variable ${variable.dapName} missing from response`, new URL(url).host, result.attempts);
      const lats = coordinate(decoded.arrays, variable.dapName, latShort, collection.grid.latName);
      const lons = coordinate(decoded.arrays, variable.dapName, lonShort, collection.grid.lonName);
      const piece = weightedSums(array.values, lats, lons.length, collection.grid.order, variable.fillValue);
      const total = sums.get(variable.key) as WeightedSums;
      total.sumW += piece.sumW;
      total.sumWV += piece.sumWV;
      total.valid += piece.valid;
      total.total += piece.total;
    }
  }

  const values = variables.map((variable) => {
    const s = sums.get(variable.key) as WeightedSums;
    return { key: variable.key, mean: s.valid > 0 && s.sumW > 0 ? s.sumWV / s.sumW : null, validCells: s.valid, totalCells: s.total };
  });
  return { values, urls, bytes, durationMs: Date.now() - started, attempts };
}
