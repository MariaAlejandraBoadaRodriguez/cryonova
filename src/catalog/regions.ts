/**
 * Region gazetteer: countries (Natural Earth 110 m boxes) plus curated named
 * regions, searched and shown in English only (D-35); aliases are used for
 * matching and are never shown. Boxes may cross the antimeridian
 * (west > east); consumers must handle that case explicitly.
 */
import generated from "./regions.generated.json";
import { normalizeText } from "./search";

export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Region {
  id: string;
  kind: "country" | "region";
  iso2: string | null;
  /** ISO 3166-1 numeric code as used by world-atlas feature ids (countries only). */
  numeric?: string | null;
  names: { en: string };
  aliases: string[];
  bbox: BBox;
}

const NAMED: Region[] = [
  { id: "region:global", kind: "region", iso2: null, names: { en: "Global" }, aliases: ["world", "whole earth", "planet"], bbox: { west: -180, south: -90, east: 180, north: 90 } },
  { id: "region:northern-hemisphere", kind: "region", iso2: null, names: { en: "Northern Hemisphere" }, aliases: ["nh"], bbox: { west: -180, south: 0, east: 180, north: 90 } },
  { id: "region:southern-hemisphere", kind: "region", iso2: null, names: { en: "Southern Hemisphere" }, aliases: ["sh"], bbox: { west: -180, south: -90, east: 180, north: 0 } },
  { id: "region:tropics", kind: "region", iso2: null, names: { en: "Tropics" }, aliases: ["tropical belt"], bbox: { west: -180, south: -23.44, east: 180, north: 23.44 } },
  { id: "region:arctic", kind: "region", iso2: null, names: { en: "Arctic" }, aliases: ["north pole"], bbox: { west: -180, south: 66.56, east: 180, north: 90 } },
  { id: "region:amazon", kind: "region", iso2: null, names: { en: "Amazon basin" }, aliases: ["amazon", "amazonia", "amazon rainforest"], bbox: { west: -79.5, south: -20, east: -48, north: 5.5 } },
  { id: "region:sahel", kind: "region", iso2: null, names: { en: "Sahel" }, aliases: ["sahel region"], bbox: { west: -18, south: 10, east: 40, north: 20 } },
  { id: "region:sahara", kind: "region", iso2: null, names: { en: "Sahara" }, aliases: ["sahara desert"], bbox: { west: -17, south: 16, east: 35, north: 33 } },
  { id: "region:mediterranean", kind: "region", iso2: null, names: { en: "Mediterranean" }, aliases: ["mediterranean sea"], bbox: { west: -6, south: 30, east: 36.5, north: 46 } },
  { id: "region:caribbean", kind: "region", iso2: null, names: { en: "Caribbean" }, aliases: ["caribbean sea"], bbox: { west: -88, south: 9, east: -59, north: 27 } },
  { id: "region:andes-tropical", kind: "region", iso2: null, names: { en: "Tropical Andes" }, aliases: ["andes", "andean region"], bbox: { west: -80, south: -18, east: -64, north: 11 } },
  { id: "region:tibetan-plateau", kind: "region", iso2: null, names: { en: "Tibetan Plateau" }, aliases: ["tibet", "himalaya", "himalayas"], bbox: { west: 73, south: 27, east: 105, north: 40 } },
  { id: "region:south-america", kind: "region", iso2: null, names: { en: "South America" }, aliases: [], bbox: { west: -82, south: -56, east: -34, north: 13 } },
  { id: "region:north-america", kind: "region", iso2: null, names: { en: "North America" }, aliases: [], bbox: { west: -170, south: 7, east: -52, north: 84 } },
  { id: "region:central-america", kind: "region", iso2: null, names: { en: "Central America" }, aliases: ["mesoamerica"], bbox: { west: -92.5, south: 7, east: -77, north: 18.5 } },
  { id: "region:europe", kind: "region", iso2: null, names: { en: "Europe" }, aliases: [], bbox: { west: -25, south: 34, east: 45, north: 72 } },
  { id: "region:africa", kind: "region", iso2: null, names: { en: "Africa" }, aliases: ["africa"], bbox: { west: -18, south: -35, east: 52, north: 38 } },
  { id: "region:southeast-asia", kind: "region", iso2: null, names: { en: "Southeast Asia" }, aliases: [], bbox: { west: 92, south: -11, east: 141, north: 28.5 } },
  { id: "region:middle-east", kind: "region", iso2: null, names: { en: "Middle East" }, aliases: ["mideast"], bbox: { west: 34, south: 12, east: 63, north: 42 } },
];

export const REGIONS: Region[] = [...NAMED, ...(generated.countries as Region[])];

export interface RegionMatch {
  region: Region;
  score: number;
}

/** Finds regions whose names or aliases match the text (exact matches first). */
export function searchRegions(text: string, limit = 8): RegionMatch[] {
  const q = normalizeText(text);
  if (q.length < 2) return [];
  const matches: RegionMatch[] = [];
  for (const region of REGIONS) {
    const names = [region.names.en, ...region.aliases].map(normalizeText);
    let score = 0;
    if (names.includes(q)) score = 100;
    else if (names.some((n) => n.startsWith(q))) score = 60;
    else if (q.length >= 4 && names.some((n) => n.includes(q))) score = 40;
    if (score > 0) matches.push({ region, score: score + (region.kind === "region" ? 1 : 0) });
  }
  return matches.sort((a, b) => b.score - a.score || a.region.names.en.localeCompare(b.region.names.en)).slice(0, limit);
}

/** Finds region names mentioned inside a free-text question (whole-word matches). */
export function findRegionsInText(text: string): Region[] {
  const q = ` ${normalizeText(text)} `;
  const found: Array<{ region: Region; length: number }> = [];
  for (const region of REGIONS) {
    const names = [region.names.en, ...region.aliases]
      .map(normalizeText)
      .filter((n) => n.length >= 4 || (region.iso2 !== null && n.length === 2 && false));
    const hit = names.filter((n) => q.includes(` ${n} `)).sort((a, b) => b.length - a.length)[0];
    if (hit) found.push({ region, length: hit.length });
  }
  return found.sort((a, b) => b.length - a.length).map((f) => f.region);
}

/** Country for a world-atlas feature id (ISO numeric), if it is in the gazetteer. */
export function regionByNumeric(numeric: string | number | undefined): Region | undefined {
  if (numeric === undefined) return undefined;
  const key = String(numeric).padStart(3, "0");
  return REGIONS.find((r) => r.numeric === key);
}

/** Countries and territories sorted by English name, for the location dropdown. */
export function countryOptions(): Region[] {
  return REGIONS.filter((r) => r.kind === "country").sort((a, b) => a.names.en.localeCompare(b.names.en));
}

export function getRegion(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id);
}

export function crossesAntimeridian(bbox: BBox): boolean {
  return bbox.west > bbox.east;
}
