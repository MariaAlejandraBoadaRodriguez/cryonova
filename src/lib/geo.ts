/** Geometry helpers for map selections (pure, unit-tested). */
import type { BBox } from "@/src/catalog/regions";

const round = (n: number) => Math.round(n * 100) / 100;
const clampLat = (n: number) => Math.max(-90, Math.min(90, n));

export function wrapLongitude(lng: number): number {
  const wrapped = ((((lng + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && lng > 0 ? 180 : wrapped;
}

/** Converts two clicked corners (possibly on a repeated world copy) into a box. */
export function cornersToBBox(a: { lat: number; lng: number }, b: { lat: number; lng: number }): BBox {
  const south = round(clampLat(Math.min(a.lat, b.lat)));
  const north = round(clampLat(Math.max(a.lat, b.lat)));
  const lo = Math.min(a.lng, b.lng);
  const hi = Math.max(a.lng, b.lng);
  if (hi - lo >= 360) return { west: -180, south, east: 180, north };
  return { west: round(wrapLongitude(lo)), south, east: round(wrapLongitude(hi)), north };
}

/** Corner pairs for map rendering; boxes crossing 180° extend past the dateline. */
export function bboxToCorners(bbox: BBox): [[number, number], [number, number]] {
  const east = bbox.west > bbox.east ? bbox.east + 360 : bbox.east;
  return [
    [bbox.south, bbox.west],
    [bbox.north, east],
  ];
}

export function bboxAreaDeg2(bbox: BBox): number {
  const width = bbox.west <= bbox.east ? bbox.east - bbox.west : bbox.east + 360 - bbox.west;
  return width * (bbox.north - bbox.south);
}
