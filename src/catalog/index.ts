import { ERA5_COLLECTIONS, ERA5_VARIABLES } from "./era5";
import { GIOVANNI_COLLECTIONS, GIOVANNI_VARIABLES } from "./giovanni";
import { GLDAS_COLLECTIONS, GLDAS_VARIABLES } from "./gldas";
import { IMERG_COLLECTIONS, IMERG_VARIABLES } from "./imerg";
import { MERRA2_COLLECTIONS, MERRA2_VARIABLES } from "./merra2";
import { NOAA_COLLECTIONS, NOAA_VARIABLES } from "./noaa";
import { SEAWIFS_COLLECTIONS, SEAWIFS_VARIABLES } from "./seawifs";
import { DERIVED } from "./derived";
import { TOPICS } from "./topics";
import type { CatalogVariable, CollectionSpec, Topic } from "./types";

export const COLLECTIONS: Record<string, CollectionSpec> = {
  ...MERRA2_COLLECTIONS,
  ...IMERG_COLLECTIONS,
  ...GLDAS_COLLECTIONS,
  ...SEAWIFS_COLLECTIONS,
  ...ERA5_COLLECTIONS,
  ...NOAA_COLLECTIONS,
  ...GIOVANNI_COLLECTIONS,
};
export const VARIABLES: CatalogVariable[] = [...MERRA2_VARIABLES, ...IMERG_VARIABLES, ...GLDAS_VARIABLES, ...SEAWIFS_VARIABLES, ...ERA5_VARIABLES, ...NOAA_VARIABLES, ...GIOVANNI_VARIABLES];

export function accessOf(collection: CollectionSpec): NonNullable<CollectionSpec["access"]> {
  return collection.access ?? "opendap";
}

/** Organisation serving the data, for provenance text. */
export function servedBy(collection: CollectionSpec): string {
  return collection.servedBy ?? "NASA Earthdata";
}

/** "M2TMNXSLV v5.12.4", or "ERA5_SL_MONTHLY (CDS)" when the version is not a number. */
export function productLabel(collection: Pick<CollectionSpec, "shortName" | "version">): string {
  return /^\d[\w.]*$/.test(collection.version) ? `${collection.shortName} v${collection.version}` : `${collection.shortName} (${collection.version})`;
}

const GEOGRAPHIC: Record<string, string> = { land: "Global, land cells only", ocean: "Global, ocean cells only", global: "Global" };
export { TOPICS };

const BY_KEY = new Map(VARIABLES.map((v) => [v.key, v]));

export function getVariable(key: string): CatalogVariable | undefined {
  return BY_KEY.get(key);
}

export function getCollection(shortName: string): CollectionSpec | undefined {
  return COLLECTIONS[shortName];
}

export function collectionOf(variable: CatalogVariable): CollectionSpec {
  const spec = COLLECTIONS[variable.collection];
  if (!spec) throw new Error(`Unknown collection ${variable.collection}`);
  return spec;
}

export function getTopic(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}

/** Declared coverage (what the provider advertises), not data actually received. */
export function declaredCoverage(variable: CatalogVariable): { start: string; end: string | null } {
  return collectionOf(variable).temporal;
}

/** Serializable catalog for the browser. Contains no secrets. */
export function publicCatalog() {
  return {
    variables: VARIABLES.map((v) => {
      const c = collectionOf(v);
      return {
        key: v.key,
        source: v.source,
        name: v.name,
        description: v.description,
        dapName: v.dapName,
        providerUnits: v.providerUnits,
        displayUnits: v.display.units,
        trendUnits: v.display.trendUnits,
        unitGroup: v.display.group,
        domain: v.domain,
        frequency: v.frequency,
        aggregation: v.aggregation,
        product: c.shortName,
        version: c.version,
        productTitle: c.title,
        fieldCount: c.fieldCount,
        resolution: c.grid.resolutionLabel,
        coverage: { temporal: c.temporal, geographic: v.geometry === "stations" ? "Weather stations inside the area" : (GEOGRAPHIC[v.domain] ?? "Global") },
        access: accessOf(c),
        servedBy: servedBy(c),
        geometry: v.geometry ?? "grid",
        words: v.words,
        phrases: v.phrases,
      };
    }),
    topics: TOPICS,
    derived: DERIVED.map((d) => ({ key: d.key, formula: d.formula, inputs: d.inputs, name: d.name, description: d.description, units: d.display.units, trendUnits: d.display.trendUnits })),
  };
}

export type PublicCatalog = ReturnType<typeof publicCatalog>;
export type PublicVariable = PublicCatalog["variables"][number];
