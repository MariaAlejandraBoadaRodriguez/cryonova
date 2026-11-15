/**
 * SeaWiFS Level-3 mapped monthly chlorophyll-a, 9 km (SeaWiFS_L3m_CHL 2022.0).
 *
 * Mission data: September 1997 to December 2010 (CMR lists 157 monthly
 * files; 2008-02, 2008-03 and 2009-05 were never produced). Each file holds
 * one period, so the arrays have no time dimension, and latitude runs north to
 * south. Names, units (mg m^-3), fill value (-32767) and grid were read from
 * the live cloud file SEASTAR_SEAWIFS_GAC.20000601_20000630.L3m.MO.CHL.chlor_a.9km.nc
 * on 2026-11-15. Ocean cells only: land, ice and cloud-covered cells hold the
 * fill value.
 */
import type { CatalogVariable, CollectionSpec } from "./types";

export const SEAWIFS_COLLECTIONS: Record<string, CollectionSpec> = {
  SeaWiFS_L3m_CHL: {
    source: "seawifs",
    shortName: "SeaWiFS_L3m_CHL",
    version: "2022.0",
    conceptId: "C3113254690-OB_CLOUD",
    title: "OrbView-2 SeaWiFS Level-3 Global Mapped Chlorophyll (CHL) Data, version 2022.0 (monthly, 9 km)",
    fieldCount: 2,
    grid: {
      lat: { start: 90 - 1 / 24, step: -1 / 12, count: 2160 },
      lon: { start: -180 + 1 / 24, step: 1 / 12, count: 4320 },
      order: "lat-lon",
      latName: "lat",
      lonName: "lon",
      resolutionLabel: "9 km (1/12°)",
      hasTime: false,
    },
    temporal: { start: "1997-09", end: "2010-12" },
    provider: "NASA Ocean Biology Processing Group / OB.DAAC",
    servedBy: "NASA OB.DAAC",
    citation:
      "NASA Ocean Biology Processing Group (2022), OrbView-2 SeaWiFS Level-3 Global Mapped Chlorophyll (CHL) Data, version 2022.0, NASA Ocean Biology Distributed Active Archive Center (OB.DAAC). doi:10.5067/ORBVIEW-2/SeaWiFS/L3M/CHL/2022.0",
    doi: "10.5067/ORBVIEW-2/SeaWiFS/L3M/CHL/2022.0",
    landingPage: "https://doi.org/10.5067/ORBVIEW-2/SeaWiFS/L3M/CHL/2022.0",
    access: "obdaac",
    granuleTitleFilter: ".L3m.MO.CHL.chlor_a.9km.nc",
  },
};

export const SEAWIFS_VARIABLES: CatalogVariable[] = [
  {
    key: "seawifs.chlor_a",
    source: "seawifs",
    collection: "SeaWiFS_L3m_CHL",
    dapName: "chlor_a",
    name: { en: "Ocean chlorophyll-a concentration (SeaWiFS)", es: "Concentración de clorofila-a en el océano (SeaWiFS)" },
    description: {
      en: "Near-surface phytoplankton chlorophyll-a retrieved from ocean colour (OCI algorithm). Ocean cells only; 1997-09 to 2010-12.",
      es: "Clorofila-a del fitoplancton cerca de la superficie, obtenida del color del océano (algoritmo OCI). Solo celdas oceánicas; 1997-09 a 2010-12.",
    },
    providerLongName: "Chlorophyll Concentration, OCI Algorithm",
    providerUnits: "mg m^-3",
    fillValue: -32767,
    display: { units: "mg/m³", scale: 1, offset: 0, trendUnits: "mg/m³ per decade", group: "chlorophyll", decimals: 3 },
    domain: "ocean",
    frequency: "monthly",
    aggregation: "Monthly composite of daily SeaWiFS retrievals (OB.DAAC L3m MO); the regional value is the cos-latitude weighted mean of valid ocean cells.",
    words: {
      en: ["chlorophyll", "phytoplankton", "ocean", "colour", "color", "seawifs", "marine", "productivity", "algae", "sea"],
      es: ["clorofila", "fitoplancton", "oceano", "color", "seawifs", "marino", "productividad", "algas", "mar"],
    },
    phrases: { en: ["ocean chlorophyll", "ocean color", "phytoplankton bloom", "marine productivity"], es: ["clorofila oceanica", "color del oceano", "floracion de fitoplancton"] },
    role: "primary",
    verified: { method: "HDF5 attributes of the 2000-06 cloud file (OPeNDAP DAS was rate limited)", date: "2026-11-15" },
  },
];
