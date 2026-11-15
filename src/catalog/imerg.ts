/**
 * GPM IMERG Final Run monthly precipitation (GPM_3IMERGM V07).
 * Grid, units and fill value were read from the live DDS/DAS on 2026-11-14.
 * The array is stored lon-major: precipitation[time][lon][lat].
 */
import type { CatalogVariable, CollectionSpec } from "./types";

export const IMERG_COLLECTIONS: Record<string, CollectionSpec> = {
  GPM_3IMERGM: {
    source: "imerg",
    shortName: "GPM_3IMERGM",
    version: "07",
    conceptId: "C2723754851-GES_DISC",
    title: "GPM IMERG Final Precipitation L3 1 month 0.1 degree x 0.1 degree V07",
    fieldCount: 6,
    grid: {
      lat: { start: -89.95, step: 0.1, count: 1800 },
      lon: { start: -179.95, step: 0.1, count: 3600 },
      order: "lon-lat",
      latName: "/Grid/lat",
      lonName: "/Grid/lon",
      resolutionLabel: "0.1° × 0.1°",
    },
    temporal: { start: "1998-01", end: "2025-09" },
    provider: "NASA GPM / GES DISC",
    citation:
      "Huffman, G.J., E.F. Stocker, D.T. Bolvin, E.J. Nelkin, J. Tan (2023), GPM IMERG Final Precipitation L3 1 month 0.1 degree x 0.1 degree V07, Greenbelt, MD, Goddard Earth Sciences Data and Information Services Center (GES DISC). doi:10.5067/GPM/IMERG/3B-MONTH/07",
    doi: "10.5067/GPM/IMERG/3B-MONTH/07",
    landingPage: "https://disc.gsfc.nasa.gov/datasets/GPM_3IMERGM_07/summary",
  },
};

export const IMERG_VARIABLES: CatalogVariable[] = [
  {
    key: "imerg.precipitation",
    source: "imerg",
    collection: "GPM_3IMERGM",
    dapName: "/Grid/precipitation",
    name: { en: "Precipitation (GPM IMERG, satellite-gauge merged)" },
    description: {
      en: "Merged microwave-infrared-gauge precipitation estimate. Provider rate in mm/hr, shown as mm/day (×24).",
    },
    providerLongName: "Merged microwave-infrared-gauge precipitation estimate",
    providerUnits: "mm/hr",
    fillValue: -9999.900391,
    display: { units: "mm/day", scale: 24, offset: 0, trendUnits: "mm/day per decade", group: "precip_rate", decimals: 3 },
    domain: "global",
    frequency: "monthly",
    aggregation: "Monthly mean precipitation rate of the IMERG Final Run (mm/hr averaged over the month).",
    words: { en: ["precipitation", "rain", "rainfall", "satellite", "gpm", "imerg"] },
    phrases: { en: ["satellite precipitation", "rainfall estimate"] },
    role: "primary",
    verified: { method: "OPeNDAP DDS/DAS of granule 2005-01", date: "2026-11-14" },
  },
];
