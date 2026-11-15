/**
 * Maps a lat/lon box onto index windows of a regular provider grid.
 *
 * Cells are selected by their centers. Boxes crossing the antimeridian
 * (west > east) produce two longitude pieces. Very large boxes are subsampled
 * with a uniform stride so a single request stays bounded; the stride is
 * reported in provenance.
 */
import type { BBox } from "@/src/catalog/regions";
import type { AxisSpec, GridSpec } from "@/src/catalog/types";

export interface IndexRange {
  start: number;
  stop: number;
  stride: number;
}

export interface GridWindow {
  lat: IndexRange;
  lon: IndexRange[];
  /** Cells requested per variable per month (after stride). */
  cells: number;
  /** Cells inside the box at native resolution. */
  nativeCells: number;
  stride: number;
  /** True when the box was smaller than one cell and snapped to the nearest cell. */
  snapped: boolean;
}

const EPS = 1e-9;

/** Index range of the cell centers inside [lo, hi]; works for ascending and descending (negative step) axes. */
export function axisRange(axis: AxisSpec, lo: number, hi: number): { start: number; stop: number } | null {
  const a = (lo - axis.start) / axis.step;
  const b = (hi - axis.start) / axis.step;
  const start = Math.max(0, Math.ceil(Math.min(a, b) - EPS));
  const stop = Math.min(axis.count - 1, Math.floor(Math.max(a, b) + EPS));
  return start > stop ? null : { start, stop };
}

/** Coordinate of the cell center at an index. */
export function coordinateAt(axis: AxisSpec, index: number): number {
  return axis.start + axis.step * index;
}

export function nearestIndex(axis: AxisSpec, value: number): number {
  return Math.min(axis.count - 1, Math.max(0, Math.round((value - axis.start) / axis.step)));
}

function countOf(range: { start: number; stop: number }, stride: number): number {
  return Math.floor((range.stop - range.start) / stride) + 1;
}

export function validateBBox(bbox: BBox): string | null {
  const values = [bbox.west, bbox.south, bbox.east, bbox.north];
  if (values.some((v) => !Number.isFinite(v))) return "Coordinates must be numbers.";
  if (bbox.south < -90 || bbox.north > 90) return "Latitudes must be between -90 and 90.";
  if (bbox.west < -180 || bbox.west > 180 || bbox.east < -180 || bbox.east > 180) return "Longitudes must be between -180 and 180.";
  if (bbox.north <= bbox.south) return "North must be greater than south.";
  if (bbox.west === bbox.east) return "West and east must differ.";
  return null;
}

export function windowForBBox(grid: GridSpec, bbox: BBox, maxCells = 12_000): GridWindow {
  const error = validateBBox(bbox);
  if (error) throw new Error(error);
  let snapped = false;

  let lat = axisRange(grid.lat, bbox.south, bbox.north);
  if (!lat) {
    const i = nearestIndex(grid.lat, (bbox.south + bbox.north) / 2);
    lat = { start: i, stop: i };
    snapped = true;
  }

  const lonPieces: Array<{ start: number; stop: number }> = [];
  const lonMax = grid.lon.start + grid.lon.step * (grid.lon.count - 1);
  if (bbox.west <= bbox.east) {
    const piece = axisRange(grid.lon, bbox.west, bbox.east);
    if (piece) lonPieces.push(piece);
  } else {
    const eastern = axisRange(grid.lon, bbox.west, lonMax);
    const western = axisRange(grid.lon, grid.lon.start, bbox.east);
    if (eastern) lonPieces.push(eastern);
    if (western) lonPieces.push(western);
  }
  if (lonPieces.length === 0) {
    const width = bbox.west <= bbox.east ? bbox.east - bbox.west : bbox.east + 360 - bbox.west;
    let center = bbox.west + width / 2;
    if (center > 180) center -= 360;
    const i = nearestIndex(grid.lon, center);
    lonPieces.push({ start: i, stop: i });
    snapped = true;
  }

  const nativeCells = countOf(lat, 1) * lonPieces.reduce((sum, p) => sum + countOf(p, 1), 0);
  const stride = nativeCells <= maxCells ? 1 : Math.ceil(Math.sqrt(nativeCells / maxCells));
  const latRange = { ...lat, stride };
  const lon = lonPieces.map((p) => ({ ...p, stride }));
  const cells = countOf(latRange, stride) * lon.reduce((sum, p) => sum + countOf(p, stride), 0);
  return { lat: latRange, lon, cells, nativeCells, stride, snapped };
}

export function hyperslab(range: IndexRange): string {
  return range.stride === 1 ? `[${range.start}:${range.stop}]` : `[${range.start}:${range.stride}:${range.stop}]`;
}
