/**
 * Model of the catalog page (/catalog): every verified variable and derived
 * series, grouped by collection (one data source and connection each), with
 * the facts a reader needs to choose a variable, and a plain English text
 * filter. Only the English catalog fields are used.
 */
import { fmtMonth } from "../lib/format";
import { DERIVED, type DerivedMetric } from "./derived";
import { accessOf, COLLECTIONS, getVariable, productLabel, servedBy, VARIABLES } from "./index";
import { normalizeText } from "./search";
import type { AccessKind, CatalogVariable, CollectionSpec, SourceId } from "./types";

/** Facts shown with every entry; they come from the entry's collection. */
export interface EntryFacts {
  /** "M2TMNXSLV v5.12.4" */
  product: string;
  productTitle: string;
  resolution: string;
  frequency: string;
  /** "Jan 1980 – present" */
  coverage: string;
  /** "Global", "Global, land cells only", "Weather stations inside the area"… */
  area: string;
  geometry: "grid" | "stations";
  /** "NASA Earthdata · NASA Cloud OPeNDAP subset" */
  access: string;
}

export interface VariableEntry {
  kind: "variable";
  key: string;
  name: string;
  /** Provider field name (last path segment of the OPeNDAP/NetCDF name, CSV column or NOAA datatype). */
  code: string;
  /** Name used in the provider request when it differs from the code (CDS variable, Giovanni field). */
  requestName?: string;
  /** The provider's own long name of the field. */
  providerName: string;
  description: string;
  /** How the monthly value is defined by the product. */
  aggregation: string;
  displayUnits: string;
  providerUnits: string;
  facts: EntryFacts;
}

export interface DerivedEntry {
  kind: "derived";
  key: string;
  name: string;
  formula: string;
  description: string;
  displayUnits: string;
  /** Variables the series is computed from (each can be added to an investigation). */
  inputs: Array<{ key: string; code: string; name: string }>;
  facts: EntryFacts;
}

export type CatalogEntry = VariableEntry | DerivedEntry;

export interface CatalogGroup {
  /** Collection short name, or "derived-<short name>" for the series derived from it. */
  id: string;
  /** Connector that serves the collection (matches the ids of /api/connectors/status). */
  source: SourceId;
  collection: string;
  /** "MERRA-2 SLV", "ERA5", "Derived from MERRA-2 SLV"… */
  label: string;
  /** "Single-Level Diagnostics", the product title… */
  title: string;
  facts: EntryFacts;
  entries: CatalogEntry[];
}

/** Connector (source) names, in catalog order. */
export const SOURCE_LABELS: Record<SourceId, string> = {
  merra2: "NASA MERRA-2",
  imerg: "NASA GPM IMERG",
  gldas: "NASA GLDAS Noah",
  seawifs: "NASA SeaWiFS (OB.DAAC)",
  era5: "Copernicus ERA5 (CDS)",
  noaa: "NOAA weather stations (GSOM)",
  giovanni: "NASA Giovanni (via Harmony)",
};

const ACCESS: Record<AccessKind, string> = {
  opendap: "NASA Cloud OPeNDAP subset",
  obdaac: "OB.DAAC OPeNDAP subset, cloud file fallback",
  cds: "Copernicus CDS retrieve job",
  harmony: "NASA Harmony job (Giovanni area average)",
  "noaa-cdo": "NOAA Climate Data Online web services",
};

const SHORT_LABELS: Record<SourceId, string> = { merra2: "MERRA-2", imerg: "GPM IMERG", gldas: "GLDAS Noah", seawifs: "SeaWiFS", era5: "ERA5", noaa: "NOAA stations", giovanni: "NASA Giovanni" };

const AREA: Record<CatalogVariable["domain"], string> = { global: "Global", land: "Global, land cells only", ocean: "Global, ocean cells only" };

/** Last path segment of a provider field name: "/Grid/precipitation" → "precipitation". */
export function fieldCode(dapName: string): string {
  return dapName.replace(/^.*\//, "");
}

export function coverageLabel(temporal: { start: string; end: string | null }): string {
  return `${fmtMonth(temporal.start)} – ${temporal.end ? fmtMonth(temporal.end) : "present"}`;
}

/** "MERRA-2 SLV", "GPM IMERG", "NASA Giovanni · GLDAS_NOAH025_M"… */
export function groupLabel(collection: Pick<CollectionSpec, "source" | "shortName">): string {
  if (collection.source === "merra2") return `MERRA-2 ${collection.shortName.replace(/^M2TMNX/, "")}`;
  if (collection.source === "giovanni") return `NASA Giovanni · ${collection.shortName.replace(/^GIOVANNI_/, "")}`;
  return SHORT_LABELS[collection.source];
}

/** MERRA-2 titles read "tavgM_2d_slv_Nx: Single-Level Diagnostics, monthly mean"; keep the readable part. */
function groupTitle(collection: CollectionSpec): string {
  if (collection.source !== "merra2") return collection.title;
  return collection.title.split(": ")[1]?.replace(/, monthly mean$/, "") ?? collection.title;
}

function facts(collection: CollectionSpec, variable?: CatalogVariable): EntryFacts {
  const geometry = variable?.geometry ?? (accessOf(collection) === "noaa-cdo" ? "stations" : "grid");
  return {
    product: productLabel(collection),
    productTitle: collection.title,
    resolution: collection.grid.resolutionLabel,
    frequency: "Monthly",
    coverage: coverageLabel(collection.temporal),
    area: geometry === "stations" ? "Weather stations inside the area" : AREA[variable?.domain ?? "global"],
    geometry,
    access: `${servedBy(collection)} · ${ACCESS[accessOf(collection)]}`,
  };
}

function variableEntry(v: CatalogVariable, collection: CollectionSpec): VariableEntry {
  const code = fieldCode(v.dapName);
  return {
    kind: "variable",
    key: v.key,
    name: v.name.en,
    code,
    requestName: v.requestName && v.requestName !== code ? v.requestName : undefined,
    providerName: v.providerLongName,
    description: v.description.en,
    aggregation: v.aggregation,
    displayUnits: v.display.units,
    providerUnits: v.providerUnits,
    facts: facts(collection, v),
  };
}

function derivedEntry(d: DerivedMetric, collection: CollectionSpec): DerivedEntry {
  const inputs = d.inputs.map((key) => {
    const v = getVariable(key);
    return { key, code: v ? fieldCode(v.dapName) : key, name: v?.name.en ?? key };
  });
  const first = getVariable(d.inputs[0] ?? "");
  return { kind: "derived", key: d.key, name: d.name.en, formula: d.formula, description: d.description.en, displayUnits: d.display.units, inputs, facts: facts(collection, first) };
}

/**
 * Groups in catalog order: one per collection, each followed by the series
 * derived from its variables (a derived series' inputs share one collection).
 */
export function catalogGroups(): CatalogGroup[] {
  const groups: CatalogGroup[] = [];
  for (const collection of Object.values(COLLECTIONS)) {
    const variables = VARIABLES.filter((v) => v.collection === collection.shortName);
    const derived = DERIVED.filter((d) => getVariable(d.inputs[0] ?? "")?.collection === collection.shortName);
    const label = groupLabel(collection);
    const base = { source: collection.source, collection: collection.shortName, facts: facts(collection, variables[0]) };
    if (variables.length > 0) groups.push({ ...base, id: collection.shortName, label, title: groupTitle(collection), entries: variables.map((v) => variableEntry(v, collection)) });
    if (derived.length > 0) groups.push({ ...base, id: `derived-${collection.shortName}`, label: `Derived from ${label}`, title: "Series computed each month from the variables above", entries: derived.map((d) => derivedEntry(d, collection)) });
  }
  return groups;
}

/** Sources that have at least one group, in catalog order. */
export function catalogSources(groups: CatalogGroup[]): Array<{ id: SourceId; label: string; count: number }> {
  const counts = new Map<SourceId, number>();
  for (const g of groups) counts.set(g.source, (counts.get(g.source) ?? 0) + g.entries.length);
  return [...counts].map(([id, count]) => ({ id, label: SOURCE_LABELS[id], count }));
}

/** Everything a reader may type to find an entry: names, codes, description, units and source. */
function haystack(entry: CatalogEntry, group: CatalogGroup): string {
  const common = [entry.name, entry.description, entry.displayUnits, group.label, group.collection, SOURCE_LABELS[group.source]];
  if (entry.kind === "derived") return normalizeText([...common, entry.formula, "derived", ...entry.inputs.flatMap((i) => [i.code, i.name])].join(" "));
  const v = getVariable(entry.key);
  const synonyms = v ? [...v.words.en, ...v.phrases.en] : [];
  return normalizeText([...common, entry.code, entry.requestName ?? "", entry.providerName.replace(/_/g, " "), entry.providerUnits, entry.aggregation, ...synonyms].join(" "));
}

const HAYSTACKS = new WeakMap<CatalogEntry, string>();

/** True when every word of the query appears in the entry (accent- and case-insensitive). */
export function entryMatches(entry: CatalogEntry, group: CatalogGroup, query: string): boolean {
  const words = normalizeText(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  let text = HAYSTACKS.get(entry);
  if (text === undefined) {
    text = haystack(entry, group);
    HAYSTACKS.set(entry, text);
  }
  return words.every((w) => text.includes(w));
}

export interface CatalogFilter {
  query: string;
  /** A source id, or "" for every source. */
  source: string;
}

/** Groups narrowed to the matching entries; groups left empty are dropped. */
export function filterCatalog(groups: CatalogGroup[], filter: CatalogFilter): CatalogGroup[] {
  return groups
    .filter((g) => !filter.source || g.source === filter.source)
    .map((g) => ({ ...g, entries: g.entries.filter((e) => entryMatches(e, g, filter.query)) }))
    .filter((g) => g.entries.length > 0);
}

export function countEntries(groups: CatalogGroup[]): { variables: number; derived: number } {
  let variables = 0;
  let derived = 0;
  for (const g of groups) {
    for (const e of g.entries) {
      if (e.kind === "variable") variables++;
      else derived++;
    }
  }
  return { variables, derived };
}
