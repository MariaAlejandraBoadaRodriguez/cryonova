/**
 * Builds src/catalog/regions.generated.json from Natural Earth 110 m country
 * shapes (world-atlas) and ISO country names in English (the platform is
 * English-only, D-35; aliases are only used for matching and are never shown).
 * Longitude extents use the largest-gap rule so countries that cross the
 * antimeridian get a box with west > east instead of a near-global box.
 */
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import countries from "i18n-iso-countries";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));
const topology = require("world-atlas/countries-110m.json");

type Position = [number, number];

function collect(geometry: { type: string; coordinates: unknown }): Position[] {
  const out: Position[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node) && typeof node[0] === "number") out.push(node as Position);
    else if (Array.isArray(node)) node.forEach(walk);
  };
  walk(geometry.coordinates);
  return out;
}

export function longitudeExtent(lons: number[]): { west: number; east: number } {
  const sorted = [...new Set(lons.map((l) => Math.round(l * 1000) / 1000))].sort((a, b) => a - b);
  const first = sorted[0] ?? -180;
  const last = sorted[sorted.length - 1] ?? 180;
  let bestGap = first + 360 - last;
  let west = first;
  let east = last;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const gap = (sorted[i + 1] as number) - (sorted[i] as number);
    if (gap > bestGap) {
      bestGap = gap;
      west = sorted[i + 1] as number;
      east = sorted[i] as number;
    }
  }
  // A shape that leaves no meaningful gap (e.g. Antarctica) spans all longitudes.
  if (bestGap < 10) return { west: -180, east: 180 };
  return { west, east };
}

const round = (n: number) => Math.round(n * 100) / 100;

const features = (feature(topology, topology.objects.countries) as unknown as {
  features: Array<{ id?: string; properties: { name: string }; geometry: { type: string; coordinates: unknown } | null }>;
}).features;

const entries = [];
for (const f of features) {
  if (!f.geometry) continue;
  const points = collect(f.geometry);
  const lats = points.map((p) => p[1]);
  const { west, east } = longitudeExtent(points.map((p) => p[0]));
  const alpha2 = f.id ? countries.numericToAlpha2(f.id) : undefined;
  const en = (alpha2 && countries.getName(alpha2, "en")) || f.properties.name;
  const aliases = new Set<string>([f.properties.name]);
  if (alpha2) {
    const all = countries.getName(alpha2, "en", { select: "all" }) as unknown as string[] | undefined;
    (all ?? []).forEach((name) => aliases.add(name));
    aliases.add(alpha2);
    const alpha3 = countries.alpha2ToAlpha3(alpha2);
    if (alpha3) aliases.add(alpha3);
  }
  entries.push({
    id: `country:${alpha2 ?? f.properties.name.toLowerCase().replace(/\W+/g, "-")}`,
    kind: "country",
    iso2: alpha2 ?? null,
    numeric: f.id ?? null,
    names: { en },
    aliases: [...aliases].filter((a) => a !== en),
    bbox: { west: round(west), south: round(Math.min(...lats)), east: round(east), north: round(Math.max(...lats)) },
  });
}

entries.sort((a, b) => a.names.en.localeCompare(b.names.en));
writeFileSync(
  new URL("../src/catalog/regions.generated.json", import.meta.url),
  `${JSON.stringify({ source: "Natural Earth 110m via world-atlas@2.0.2; names via i18n-iso-countries@7.14.0", countries: entries }, null, 1)}\n`,
);
console.log(`wrote ${entries.length} countries; antimeridian-crossing: ${entries.filter((e) => e.bbox.west > e.bbox.east).map((e) => e.names.en).join(", ")}`);
