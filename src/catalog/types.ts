import { z } from "zod";

export const Localized = z.object({ en: z.string(), es: z.string() });
export type Localized = z.infer<typeof Localized>;

export const LocalizedList = z.object({ en: z.array(z.string()), es: z.array(z.string()) });
export type LocalizedList = z.infer<typeof LocalizedList>;

/** A regular lat/lon grid as published by the provider (cell centers). A negative step is a descending axis (north to south). */
export interface AxisSpec {
  start: number;
  step: number;
  count: number;
}

export interface GridSpec {
  lat: AxisSpec;
  lon: AxisSpec;
  /** Dimension order of the data array after the leading time dimension. */
  order: "lat-lon" | "lon-lat";
  latName: string;
  lonName: string;
  resolutionLabel: string;
  /** False when the data array has no leading time dimension (OB.DAAC L3m files hold one period each). */
  hasTime?: boolean;
}

/**
 * How a collection is read.
 * - opendap: CMR granule search + NASA Cloud OPeNDAP subset (MERRA-2, IMERG, GLDAS).
 * - obdaac: CMR granule search + OB.DAAC OPeNDAP subset, falling back to the cloud file (SeaWiFS).
 * - cds: one asynchronous Copernicus CDS retrieve job per run, polled until it is ready (ERA5).
 * - harmony: one asynchronous NASA Harmony job per run, served by Giovanni's area-averaging service.
 * - noaa-cdo: NOAA CDO station search plus monthly station observations (GSOM).
 */
export type AccessKind = "opendap" | "obdaac" | "cds" | "harmony" | "noaa-cdo";

export interface CollectionSpec {
  source: SourceId;
  shortName: string;
  version: string;
  conceptId: string;
  title: string;
  /** Number of data fields counted in the live DDS (verified). */
  fieldCount: number;
  grid: GridSpec;
  temporal: { start: string; end: string | null };
  provider: string;
  citation: string;
  doi?: string;
  landingPage: string;
  /** Defaults to "opendap". */
  access?: AccessKind;
  /** Short name of the organisation serving the data, used in provenance text. */
  servedBy?: string;
  /** Only granules whose title contains this text are used (OB.DAAC lists daily, 8-day and monthly files together). */
  granuleTitleFilter?: string;
  /** Provider request identifiers for non-OPeNDAP access (CDS dataset and product type, NOAA dataset). */
  remote?: { dataset: string; productType?: string };
}

export type SourceId = "merra2" | "imerg" | "gldas" | "seawifs" | "era5" | "noaa" | "giovanni";

export type UnitGroup =
  | "temperature"
  | "precip_rate"
  | "pressure"
  | "specific_humidity"
  | "water_column"
  | "wind"
  | "energy_flux"
  | "fraction"
  | "percent"
  | "optical_depth"
  | "height"
  | "ozone"
  | "snow_mass"
  | "temperature_variance"
  | "vertical_velocity"
  | "column_mass"
  | "trace_humidity"
  | "soil_moisture"
  | "volumetric_water"
  | "chlorophyll"
  | "precip_total";

export interface DisplayUnits {
  units: string;
  /** display = provider * scale + offset */
  scale: number;
  offset: number;
  /** Units for slopes (offset does not apply). */
  trendUnits: string;
  group: UnitGroup;
  decimals: number;
}

export type Domain = "global" | "land" | "ocean";

export interface CatalogVariable {
  key: string;
  source: SourceId;
  collection: string;
  /** Variable path as named in the OPeNDAP DDS or in the decoded file (NetCDF variable, CSV column, NOAA datatype). */
  dapName: string;
  /** Name used in the provider request when it differs from dapName (CDS variable, Giovanni data field ID). */
  requestName?: string;
  name: Localized;
  description: Localized;
  providerLongName: string;
  providerUnits: string;
  fillValue: number;
  display: DisplayUnits;
  domain: Domain;
  /** Gridded field (default) or station observations. */
  geometry?: "grid" | "stations";
  frequency: "monthly";
  /** How the monthly value is defined by the product. */
  aggregation: string;
  words: LocalizedList;
  phrases: LocalizedList;
  role: "primary" | "variability";
  verified: { method: string; date: string };
}

export type AnalysisKind =
  | "monthly_series"
  | "annual_trend"
  | "seasonal_cycle"
  | "monthly_anomalies"
  | "annual_ranking"
  | "period_comparison"
  | "seasonal_trends"
  | "positive_streaks";

export interface Topic {
  id: string;
  title: Localized;
  question: Localized;
  variables: string[];
  collections: string[];
  fieldCount: number;
  extraAnalyses: AnalysisKind[];
  suggestedPeriod: { start: string; end: string };
  /** Length of the suggested period in complete years (the original catalog uses 20 or 30). */
  suggestedYears: number;
  /** Derived series the topic's question asks for (see derived.ts). */
  derived: string[];
  /** "original" = the 22-topic catalog of the approved prototype (+ its rain case); "extension" = added from live-verified collections. */
  origin: "original" | "extension";
  words: LocalizedList;
  phrases: LocalizedList;
}
