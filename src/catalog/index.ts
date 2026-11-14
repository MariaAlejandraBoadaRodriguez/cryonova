import { IMERG_COLLECTIONS, IMERG_VARIABLES } from "./imerg";
import { MERRA2_COLLECTIONS, MERRA2_VARIABLES } from "./merra2";
import { TOPICS } from "./topics";
import type { CatalogVariable, CollectionSpec, Topic } from "./types";

export const COLLECTIONS: Record<string, CollectionSpec> = { ...MERRA2_COLLECTIONS, ...IMERG_COLLECTIONS };
export const VARIABLES: CatalogVariable[] = [...MERRA2_VARIABLES, ...IMERG_VARIABLES];
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
        coverage: { temporal: c.temporal, geographic: v.domain === "land" ? "Global, land cells only" : "Global" },
        words: v.words,
        phrases: v.phrases,
      };
    }),
    topics: TOPICS,
  };
}

export type PublicCatalog = ReturnType<typeof publicCatalog>;
export type PublicVariable = PublicCatalog["variables"][number];
