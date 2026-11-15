/**
 * OB.DAAC Level-3 mapped files (SeaWiFS chlorophyll).
 *
 * The subset is first requested from OB.DAAC's OPeNDAP server, exactly like the
 * GES DISC collections. That server rate-limits some networks (HTTP 429), so
 * when it fails the same monthly file is downloaded from OB.DAAC's cloud
 * archive instead: the Earthdata token is sent only to the archive's TEA host,
 * which answers with a signed CloudFront link that is fetched without
 * credentials, and the window is cut from the NetCDF-4 file with h5wasm.
 */
import type { CatalogVariable, CollectionSpec } from "@/src/catalog/types";
import { parseBytes, ProviderError, redirectLocation, requestWithPolicy } from "@/src/lib/http";
import { type GridWindow, type IndexRange } from "./grid";
import { type GranuleRead, type ReadOptions, readGranule, type WeightedSums, weightedSums } from "./gridded";
import { withNetcdf } from "./netcdf";
import { POLICIES, withSignal } from "./policies";

export const OBDAAC_CLOUD = "https://obdaac-tea.earthdatacloud.nasa.gov/ob-cumulus-prod-public";

export interface ObdaacRead extends GranuleRead {
  via: "opendap" | "cloud-file";
  /** Why OPeNDAP was not used, when the cloud file was read instead. */
  fallbackReason?: string;
}

export function cloudFileUrl(opendapUrl: string): string {
  const file = opendapUrl.split("?")[0]!.split("/").pop();
  if (!file || !file.endsWith(".nc")) throw new ProviderError("bad_request", "Cannot derive the OB.DAAC file name", "obdaac-tea.earthdatacloud.nasa.gov", 0);
  return `${OBDAAC_CLOUD}/${file}`;
}

function rangeOf(range: IndexRange): [number, number, number] {
  return [range.start, range.stop + 1, range.stride];
}

/** Reads the window from a downloaded L3m file (lat-lon arrays, no time dimension). */
export async function readCloudFile(opendapUrl: string, collection: CollectionSpec, variables: CatalogVariable[], window: GridWindow, options: ReadOptions): Promise<ObdaacRead> {
  const started = Date.now();
  const url = cloudFileUrl(opendapUrl);
  const link = await redirectLocation(url, { Authorization: `Bearer ${options.token}` }, withSignal(POLICIES.signedLink, options.policy.signal), options.fetchImpl);
  // The signed link carries its own authorization: never send the token with it.
  const file = await requestWithPolicy(link.value, {}, withSignal(POLICIES.fileDownload, options.policy.signal), parseBytes, options.fetchImpl);
  const sums = await withNetcdf(file.value, (nc) =>
    variables.map((variable) => {
      const total: WeightedSums = { sumW: 0, sumWV: 0, valid: 0, total: 0 };
      const lats = nc.read(collection.grid.latName, [rangeOf(window.lat)]);
      for (const piece of window.lon) {
        const values = nc.read(variable.dapName, [rangeOf(window.lat), rangeOf(piece)]);
        const nLon = Math.floor((piece.stop - piece.start) / piece.stride) + 1;
        const part = weightedSums(values, lats, nLon, "lat-lon", variable.fillValue);
        total.sumW += part.sumW;
        total.sumWV += part.sumWV;
        total.valid += part.valid;
        total.total += part.total;
      }
      return { variable, total };
    }),
  );
  return {
    values: sums.map(({ variable, total }) => ({ key: variable.key, mean: total.valid > 0 && total.sumW > 0 ? total.sumWV / total.sumW : null, validCells: total.valid, totalCells: total.total })),
    urls: [url],
    bytes: file.value.byteLength,
    durationMs: Date.now() - started,
    attempts: link.attempts + file.attempts,
    via: "cloud-file",
  };
}

export interface ObdaacOptions extends ReadOptions {
  /**
   * Asked only when OPeNDAP failed: reserves one full-file fallback read for this
   * run and returns false once the run's limit is reached. Without it, no
   * fallback is attempted.
   */
  allowCloudFile?: () => boolean;
}

export async function readObdaacGranule(opendapUrl: string, collection: CollectionSpec, variables: CatalogVariable[], window: GridWindow, options: ObdaacOptions): Promise<ObdaacRead> {
  try {
    const read = await readGranule(opendapUrl, collection, variables, window, options);
    return { ...read, via: "opendap" };
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "cancelled") throw error;
    const reason = error instanceof ProviderError ? `${error.kind}${error.status ? ` (HTTP ${error.status})` : ""}` : "decode error";
    if (!options.allowCloudFile?.()) {
      const host = error instanceof ProviderError ? error.host : "oceandata.sci.gsfc.nasa.gov";
      throw new ProviderError(
        error instanceof ProviderError ? error.kind : "bad_response",
        `OB.DAAC OPeNDAP ${reason}; the full-file fallback (about 10.7 MB per month) is limited per run and was not used for this month`,
        host,
        error instanceof ProviderError ? error.attempts : 1,
        error instanceof ProviderError ? error.status : undefined,
      );
    }
    const read = await readCloudFile(opendapUrl, collection, variables, window, options);
    return { ...read, fallbackReason: `OB.DAAC OPeNDAP ${reason}` };
  }
}
