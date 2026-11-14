/**
 * Decoder for OPeNDAP DAP2 binary responses (.dods): a DDS text header,
 * the "Data:" marker, then XDR-encoded values in declaration order.
 * Arrays carry their length twice; 8- and 16-bit integers are widened to
 * 32 bits, except Byte arrays which are packed and padded to 4 bytes.
 */
import { type DapArrayDecl, type DapDecl, type Dds, parseDds } from "./dds";

export interface DecodedArray {
  name: string;
  type: DapArrayDecl["type"];
  dims: DapArrayDecl["dims"];
  values: Float64Array;
}

export class DodsDecodeError extends Error {}

const MARKER = [0x0a, 0x44, 0x61, 0x74, 0x61, 0x3a, 0x0a]; // "\nData:\n"

function findMarker(bytes: Uint8Array): number {
  outer: for (let i = 0; i <= bytes.length - MARKER.length; i += 1) {
    for (let j = 0; j < MARKER.length; j += 1) {
      if (bytes[i + j] !== MARKER[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function decodeDods(bytes: Uint8Array): { dds: Dds; arrays: Map<string, DecodedArray> } {
  const markerAt = findMarker(bytes);
  if (markerAt < 0) {
    const preview = new TextDecoder().decode(bytes.slice(0, 200));
    throw new DodsDecodeError(`Response has no DAP2 data marker: ${preview.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  const dds = parseDds(new TextDecoder().decode(bytes.slice(0, markerAt)));
  const view = new DataView(bytes.buffer, bytes.byteOffset + markerAt + MARKER.length, bytes.length - markerAt - MARKER.length);
  let offset = 0;
  const arrays = new Map<string, DecodedArray>();

  const need = (n: number) => {
    if (offset + n > view.byteLength) throw new DodsDecodeError("Truncated DAP2 payload");
  };

  function readValues(decl: DapArrayDecl): Float64Array {
    if (decl.type === "String" || decl.type === "Url") throw new DodsDecodeError("String variables are not supported");
    const expected = decl.dims.reduce((p, d) => p * d.size, 1);
    let count = 1;
    if (decl.dims.length > 0) {
      need(8);
      count = view.getUint32(offset, false);
      const repeated = view.getUint32(offset + 4, false);
      offset += 8;
      if (count !== repeated || count !== expected) {
        throw new DodsDecodeError(`Length mismatch for ${decl.name}: ${count}/${repeated}, expected ${expected}`);
      }
    }
    const out = new Float64Array(count);
    const isByte = decl.type === "Byte" || decl.type === "UInt8" || decl.type === "Int8";
    if (isByte && decl.dims.length > 0) {
      const padded = Math.ceil(count / 4) * 4;
      need(padded);
      for (let i = 0; i < count; i += 1) {
        const raw = view.getUint8(offset + i);
        out[i] = decl.type === "Int8" && raw > 127 ? raw - 256 : raw;
      }
      offset += padded;
      return out;
    }
    const size = decl.type === "Float64" ? 8 : 4;
    need(count * size);
    for (let i = 0; i < count; i += 1) {
      const at = offset + i * size;
      switch (decl.type) {
        case "Float64":
          out[i] = view.getFloat64(at, false);
          break;
        case "Float32":
          out[i] = view.getFloat32(at, false);
          break;
        case "UInt32":
        case "UInt16":
          out[i] = view.getUint32(at, false);
          break;
        default:
          out[i] = view.getInt32(at, false);
      }
    }
    offset += count * size;
    return out;
  }

  function walk(decl: DapDecl, prefix: string): void {
    if (decl.kind === "array") {
      const name = prefix ? `${prefix}.${decl.name}` : decl.name;
      arrays.set(name, { name, type: decl.type, dims: decl.dims, values: readValues(decl) });
    } else if (decl.kind === "grid") {
      const gridName = prefix ? `${prefix}.${decl.name}` : decl.name;
      arrays.set(gridName, { name: gridName, type: decl.array.type, dims: decl.array.dims, values: readValues(decl.array) });
      for (const map of decl.maps) {
        const mapName = `${gridName}.${map.name}`;
        arrays.set(mapName, { name: mapName, type: map.type, dims: map.dims, values: readValues(map) });
      }
    } else {
      const structName = prefix ? `${prefix}.${decl.name}` : decl.name;
      for (const member of decl.members) walk(member, structName);
    }
  }

  for (const decl of dds.decls) walk(decl, "");
  if (offset !== view.byteLength) {
    throw new DodsDecodeError(`Unexpected trailing bytes: decoded ${offset} of ${view.byteLength}`);
  }
  return { dds, arrays };
}
