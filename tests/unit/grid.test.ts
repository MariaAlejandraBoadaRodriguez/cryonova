import { describe, expect, it } from "vitest";
import { MERRA2_COLLECTIONS } from "@/src/catalog/merra2";
import { IMERG_COLLECTIONS } from "@/src/catalog/imerg";
import { axisRange, hyperslab, validateBBox, windowForBBox } from "@/src/providers/grid";

const merra = MERRA2_COLLECTIONS.M2TMNXSLV!.grid;
const imerg = IMERG_COLLECTIONS.GPM_3IMERGM!.grid;

describe("grid windows", () => {
  it("matches the index window used in the live Colombia request", () => {
    const w = windowForBBox(merra, { west: -79, south: -4.2, east: -66.85, north: 12.5 });
    expect(w.lat).toEqual({ start: 172, stop: 205, stride: 1 });
    expect(w.lon).toEqual([{ start: 162, stop: 181, stride: 1 }]);
    expect(w.cells).toBe(680);
    expect(w.snapped).toBe(false);
  });

  it("splits boxes that cross the antimeridian into two longitude pieces", () => {
    const w = windowForBBox(merra, { west: 170, south: -20, east: -170, north: -10 });
    expect(w.lon).toHaveLength(2);
    expect(w.lon[0]).toEqual({ start: 560, stop: 575, stride: 1 });
    expect(w.lon[1]).toEqual({ start: 0, stop: 16, stride: 1 });
    expect(w.cells).toBe(21 * 33);
  });

  it("subsamples very large boxes with a uniform reported stride", () => {
    const w = windowForBBox(merra, { west: -180, south: -90, east: 180, north: 90 });
    expect(w.nativeCells).toBe(361 * 576);
    expect(w.stride).toBe(5);
    expect(w.cells).toBeLessThanOrEqual(12_000);
    expect(hyperslab(w.lat)).toBe("[0:5:360]");
  });

  it("snaps a box smaller than one cell to the nearest cell", () => {
    const w = windowForBBox(imerg, { west: -74.08, south: 4.6, east: -74.07, north: 4.61 });
    expect(w.snapped).toBe(true);
    expect(w.cells).toBe(1);
  });

  it("validates coordinates", () => {
    expect(validateBBox({ west: -10, south: 5, east: 10, north: 5 })).toMatch(/North/);
    expect(validateBBox({ west: -190, south: 0, east: 10, north: 5 })).toMatch(/Longitudes/);
    expect(validateBBox({ west: 10, south: -95, east: 20, north: 5 })).toMatch(/Latitudes/);
    expect(validateBBox({ west: 10, south: 0, east: 10, north: 5 })).toMatch(/differ/);
    expect(validateBBox({ west: Number.NaN, south: 0, east: 10, north: 5 })).toMatch(/numbers/);
    expect(() => windowForBBox(merra, { west: 0, south: 10, east: 5, north: 0 })).toThrow();
    expect(axisRange(merra.lat, 0.1, 0.4)).toBeNull();
  });
});
