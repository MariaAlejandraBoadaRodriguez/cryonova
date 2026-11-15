/**
 * Minimal ZIP reader (stored and deflate entries, no ZIP64). Copernicus CDS
 * returns a ZIP of NetCDF files when the requested variables have different
 * GRIB step types (e.g. 2 m temperature and total precipitation), even with
 * download_format "unarchived".
 */
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function unzip(bytes: Uint8Array, maxTotalBytes = 512 * 1024 * 1024): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP end of central directory not found");
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let total = 0;
  for (let n = 0; n < count; n += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("Corrupt ZIP central directory");
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (compressed === 0xffffffff || size === 0xffffffff) throw new Error("ZIP64 archives are not supported");
    total += size;
    if (total > maxTotalBytes) throw new Error("ZIP content is larger than allowed");
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("Corrupt ZIP local header");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(inflateRawSync(raw));
    else throw new Error(`Unsupported ZIP compression method ${method}`);
    if (data.length !== size) throw new Error(`ZIP entry ${name} has the wrong size`);
    if (!name.endsWith("/")) entries.push({ name, data });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
