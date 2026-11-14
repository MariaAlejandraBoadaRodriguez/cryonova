import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDds, DdsParseError } from "@/src/providers/opendap/dds";
import { decodeDods, DodsDecodeError } from "@/src/providers/opendap/dods";
import { weightedSums } from "@/src/providers/gridded";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/opendap/${name}`, import.meta.url)));

describe("DDS parser", () => {
  it("parses the full MERRA-2 SLV DDS with 94 grid fields", () => {
    const dds = parseDds(new TextDecoder().decode(fixture("merra2_slv_200501.dds")));
    const grids = dds.decls.filter((d) => d.kind === "grid");
    expect(grids).toHaveLength(94);
    const t2m = grids.find((g) => g.name === "T2M");
    expect(t2m?.kind === "grid" && t2m.array.dims.map((d) => d.size)).toEqual([1, 361, 576]);
    expect(t2m?.kind === "grid" && t2m.maps.map((m) => m.name)).toEqual(["time", "lat", "lon"]);
  });

  it("handles group-prefixed names, scalars and structures", () => {
    const dds = parseDds(`Dataset {
      Int32 count;
      Float32 /Grid/lat[lat = 2];
      Structure { Float64 x[n = 3]; } box;
    } sample;`);
    expect(dds.name).toBe("sample");
    expect(dds.decls.map((d) => d.name)).toEqual(["count", "/Grid/lat", "box"]);
  });

  it("rejects malformed or unsupported input", () => {
    expect(() => parseDds("Dataset { Float32 x[n = 2] } a;")).toThrow(DdsParseError);
    expect(() => parseDds("Dataset { Sequence { Int32 a; } s; } d;")).toThrow(DdsParseError);
    expect(() => parseDds("Dataset { Complex64 z; } d;")).toThrow(DdsParseError);
  });
});

describe("DODS decoder on a live response (Colombia, 2005-01)", () => {
  const { arrays } = decodeDods(fixture("merra2_slv_200501_colombia_t2m.dods"));

  it("decodes arrays, grids and maps with the expected sizes", () => {
    expect(arrays.get("lon")?.values.length).toBe(20);
    expect(arrays.get("lat")?.values.length).toBe(34);
    expect(arrays.get("T2M")?.values.length).toBe(680);
    expect(arrays.get("T2M.time")?.values.length).toBe(1);
    expect(arrays.get("T2M.lat")?.values[0]).toBe(-4);
    expect(arrays.get("T2M.lat")?.values[33]).toBe(12.5);
    expect(arrays.get("T2M.lon")?.values[0]).toBe(-78.75);
    expect(arrays.get("T2M.lon")?.values[19]).toBe(-66.875);
  });

  it("reproduces the cos-latitude weighted mean computed independently in Python", () => {
    const lats = arrays.get("T2M.lat")!.values;
    const sums = weightedSums(arrays.get("T2M")!.values, lats, 20, "lat-lon", 9.99999987e14);
    expect(sums.valid).toBe(680);
    expect(sums.sumWV / sums.sumW).toBeCloseTo(298.373, 3);
  });

  it("fails loudly on truncated or non-DAP payloads", () => {
    const bytes = fixture("merra2_slv_200501_colombia_t2m.dods");
    expect(() => decodeDods(bytes.slice(0, bytes.length - 10))).toThrow(DodsDecodeError);
    expect(() => decodeDods(new TextEncoder().encode("<html>Login required</html>"))).toThrow(/no DAP2 data marker/);
  });

  it("decodes byte arrays with padding and widened 16-bit integers", () => {
    const header = new TextEncoder().encode("Dataset {\n    Byte b[n = 3];\n    Int16 s[m = 2];\n} t;\nData:\n");
    const payload = new Uint8Array([0, 0, 0, 3, 0, 0, 0, 3, 1, 2, 255, 0, 0, 0, 0, 2, 0, 0, 0, 2, 255, 255, 255, 254, 0, 0, 0, 7]);
    const merged = new Uint8Array(header.length + payload.length);
    merged.set(header);
    merged.set(payload, header.length);
    const decoded = decodeDods(merged);
    expect([...decoded.arrays.get("b")!.values]).toEqual([1, 2, 255]);
    expect([...decoded.arrays.get("s")!.values]).toEqual([-2, 7]);
  });
});
