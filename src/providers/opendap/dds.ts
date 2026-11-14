/**
 * Minimal parser for OPeNDAP DAP2 Dataset Descriptor Structures (DDS).
 * Supports the declarations used by gridded NASA products: arrays, scalars,
 * Grids (array + maps) and Structures.
 */
export type DapType = "Byte" | "Int8" | "UInt8" | "Int16" | "UInt16" | "Int32" | "UInt32" | "Float32" | "Float64" | "String" | "Url";

export interface DapDim {
  name: string;
  size: number;
}

export interface DapArrayDecl {
  kind: "array";
  type: DapType;
  name: string;
  dims: DapDim[];
}

export interface DapGridDecl {
  kind: "grid";
  name: string;
  array: DapArrayDecl;
  maps: DapArrayDecl[];
}

export interface DapStructureDecl {
  kind: "structure";
  name: string;
  members: DapDecl[];
}

export type DapDecl = DapArrayDecl | DapGridDecl | DapStructureDecl;

export interface Dds {
  name: string;
  decls: DapDecl[];
}

const TYPES = new Set<string>(["Byte", "Int8", "UInt8", "Int16", "UInt16", "Int32", "UInt32", "Float32", "Float64", "String", "Url"]);

export class DdsParseError extends Error {}

function tokenize(text: string): string[] {
  return text.match(/[{}[\];=:]|[^\s{}[\];=:]+/g) ?? [];
}

export function parseDds(text: string): Dds {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => {
    const token = tokens[pos];
    if (token === undefined) throw new DdsParseError("Unexpected end of DDS");
    pos += 1;
    return token;
  };
  const expect = (value: string) => {
    const token = next();
    if (token !== value) throw new DdsParseError(`Expected "${value}" but found "${token}"`);
  };

  function parseArray(): DapArrayDecl {
    const type = next();
    if (!TYPES.has(type)) throw new DdsParseError(`Unsupported DAP type "${type}"`);
    const name = next();
    const dims: DapDim[] = [];
    while (peek() === "[") {
      next();
      let dimName = "";
      let sizeToken = next();
      if (peek() === "=") {
        next();
        dimName = sizeToken;
        sizeToken = next();
      }
      const size = Number(sizeToken);
      if (!Number.isInteger(size) || size < 0) throw new DdsParseError(`Invalid dimension size "${sizeToken}"`);
      dims.push({ name: dimName, size });
      expect("]");
    }
    expect(";");
    return { kind: "array", type: type as DapType, name, dims };
  }

  function parseDecl(): DapDecl {
    const head = peek();
    if (head === "Grid") {
      next();
      expect("{");
      const section = next();
      if (section.toLowerCase() !== "array") throw new DdsParseError(`Expected Array section, found "${section}"`);
      expect(":");
      const array = parseArray();
      const mapsLabel = next();
      if (mapsLabel.toLowerCase() !== "maps") throw new DdsParseError(`Expected Maps section, found "${mapsLabel}"`);
      expect(":");
      const maps: DapArrayDecl[] = [];
      while (peek() !== "}") maps.push(parseArray());
      expect("}");
      const name = next();
      expect(";");
      return { kind: "grid", name, array, maps };
    }
    if (head === "Structure") {
      next();
      expect("{");
      const members: DapDecl[] = [];
      while (peek() !== "}") members.push(parseDecl());
      expect("}");
      const name = next();
      expect(";");
      return { kind: "structure", name, members };
    }
    if (head === "Sequence") throw new DdsParseError("DAP Sequences are not supported");
    return parseArray();
  }

  expect("Dataset");
  expect("{");
  const decls: DapDecl[] = [];
  while (peek() !== "}") decls.push(parseDecl());
  expect("}");
  const name = next();
  expect(";");
  return { name, decls };
}
