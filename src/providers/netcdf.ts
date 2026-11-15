/**
 * Minimal NetCDF-4 (HDF5) reader for server-side use, backed by h5wasm's Node
 * build (HDF5 compiled to WebAssembly; no native dependency). Used for the
 * ERA5 files produced by Copernicus CDS jobs and for OB.DAAC cloud files.
 *
 * h5wasm's Node build opens files from the local file system, so the bytes are
 * written to a private temporary directory that is always removed afterwards.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type H5Module = (typeof import("h5wasm/node"))["default"];
type H5File = InstanceType<H5Module["File"]>;

let loading: Promise<H5Module> | null = null;

async function loadH5(): Promise<H5Module> {
  loading ??= import("h5wasm/node").then(async (mod) => {
    const h5 = (mod as { default?: H5Module }).default ?? (mod as unknown as H5Module);
    await h5.ready;
    return h5;
  });
  return loading;
}

/** [start, stopExclusive, step] per dimension, as h5wasm expects. */
export type NcRange = [number, number, number?];

export class NetcdfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetcdfError";
  }
}

export interface NcReader {
  names(): string[];
  has(name: string): boolean;
  shape(name: string): number[];
  attr(name: string, attribute: string): unknown;
  /** Attribute as a string, or null. */
  text(name: string, attribute: string): string | null;
  /** Attribute as a number (first element of an array attribute), or null. */
  number(name: string, attribute: string): number | null;
  /** Values of a variable (optionally a hyperslab), with scale_factor/add_offset applied; fill values become NaN. */
  read(name: string, ranges?: NcRange[]): Float64Array;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (ArrayBuffer.isView(value) && "length" in value && (value as unknown as ArrayLike<number>).length > 0) return Number((value as unknown as ArrayLike<number>)[0]);
  if (Array.isArray(value) && value.length > 0) return Number(value[0]);
  return null;
}

function makeReader(file: H5File): NcReader {
  const dataset = (name: string) => {
    const node = file.get(name);
    if (!node || !("shape" in node)) throw new NetcdfError(`Variable ${name} is not in the file`);
    return node as unknown as { shape: number[]; attrs: Record<string, { value: unknown }>; value: unknown; slice(ranges: Array<[number | null, number | null, number | null] | [number | null, number | null]>): unknown };
  };
  const attr = (name: string, attribute: string): unknown => {
    try {
      return dataset(name).attrs[attribute]?.value ?? null;
    } catch {
      return null;
    }
  };
  return {
    names: () => file.keys(),
    has: (name) => {
      const node = file.get(name);
      return Boolean(node && "shape" in node);
    },
    shape: (name) => [...dataset(name).shape],
    attr,
    text: (name, attribute) => {
      const value = attr(name, attribute);
      return typeof value === "string" ? value : null;
    },
    number: (name, attribute) => toNumber(attr(name, attribute)),
    read: (name, ranges) => {
      const ds = dataset(name);
      const raw = ranges ? ds.slice(ranges.map(([a, b, step]) => (step && step > 1 ? [a, b, step] : [a, b]) as [number, number, number] | [number, number])) : ds.value;
      if (raw === null || raw === undefined || typeof (raw as ArrayLike<number>).length !== "number") throw new NetcdfError(`Variable ${name} could not be read`);
      const source = raw as ArrayLike<number | bigint>;
      const scale = toNumber(attr(name, "scale_factor")) ?? 1;
      const offset = toNumber(attr(name, "add_offset")) ?? 0;
      const fill = toNumber(attr(name, "_FillValue"));
      const missing = toNumber(attr(name, "missing_value"));
      const out = new Float64Array(source.length);
      for (let i = 0; i < source.length; i += 1) {
        const v = Number(source[i]);
        out[i] = !Number.isFinite(v) || (fill !== null && v === fill) || (missing !== null && v === missing) ? Number.NaN : v * scale + offset;
      }
      return out;
    },
  };
}

/** Opens NetCDF-4/HDF5 bytes, runs fn, and always closes and deletes the temporary file. */
export async function withNetcdf<T>(bytes: Uint8Array, fn: (nc: NcReader) => T | Promise<T>): Promise<T> {
  if (bytes.byteLength < 8 || bytes[1] !== 0x48 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new NetcdfError("The file is not NetCDF-4/HDF5 (missing HDF5 signature)");
  }
  const h5 = await loadH5();
  const dir = await mkdtemp(join(tmpdir(), "cryonova-nc-"));
  const path = join(dir, "data.nc");
  try {
    await writeFile(path, bytes);
    const file = new h5.File(path, "r");
    try {
      return await fn(makeReader(file));
    } finally {
      file.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
