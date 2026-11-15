/**
 * GLDAS Noah land surface model, monthly 0.25° (GLDAS_NOAH025_M 2.1).
 *
 * Read through NASA Cloud OPeNDAP like MERRA-2. The grid, field count (36),
 * names, units, long names and fill values were read from the live DDS/DAS of
 * granule GLDAS_NOAH025_M.A201006.021.nc4 on 2026-11-15. Land cells only: ocean
 * and Antarctica cells hold the fill value (-9999) and are excluded.
 */
import type { CatalogVariable, CollectionSpec, DisplayUnits } from "./types";

export const GLDAS_COLLECTIONS: Record<string, CollectionSpec> = {
  GLDAS_NOAH025_M: {
    source: "gldas",
    shortName: "GLDAS_NOAH025_M",
    version: "2.1",
    conceptId: "C1342986036-GES_DISC",
    title: "GLDAS Noah Land Surface Model L4 monthly 0.25 x 0.25 degree V2.1",
    fieldCount: 36,
    grid: {
      lat: { start: -59.875, step: 0.25, count: 600 },
      lon: { start: -179.875, step: 0.25, count: 1440 },
      order: "lat-lon",
      latName: "lat",
      lonName: "lon",
      resolutionLabel: "0.25° × 0.25°",
    },
    temporal: { start: "2000-01", end: null },
    provider: "NASA GSFC Hydrological Sciences Laboratory / GES DISC",
    servedBy: "NASA Earthdata",
    citation:
      "Beaudoing, H. and M. Rodell, NASA/GSFC/HSL (2020), GLDAS Noah Land Surface Model L4 monthly 0.25 x 0.25 degree V2.1, Greenbelt, Maryland, USA, Goddard Earth Sciences Data and Information Services Center (GES DISC). doi:10.5067/SXAVCZFAQLNO",
    doi: "10.5067/SXAVCZFAQLNO",
    landingPage: "https://disc.gsfc.nasa.gov/datasets/GLDAS_NOAH025_M_2.1/summary",
  },
};

const FILL = -9999;
const VERIFIED = { method: "OPeNDAP DDS/DAS of granule 2010-06", date: "2026-11-15" };
const soil: DisplayUnits = { units: "kg/m²", scale: 1, offset: 0, trendUnits: "kg/m² per decade", group: "soil_moisture", decimals: 2 };
const flux: DisplayUnits = { units: "mm/day", scale: 86400, offset: 0, trendUnits: "mm/day per decade", group: "precip_rate", decimals: 3 };

function layer(dapName: string, depth: string, words: string[]): CatalogVariable {
  return {
    key: `gldas.${dapName}`,
    source: "gldas",
    collection: "GLDAS_NOAH025_M",
    dapName,
    name: { en: `Soil moisture ${depth} (GLDAS Noah)` },
    description: { en: `Water held in the ${depth} soil layer, as mass per unit area (1 kg/m² = 1 mm of water). Land cells only.` },
    providerLongName: "Soil moisture",
    providerUnits: "kg m-2",
    fillValue: FILL,
    display: soil,
    domain: "land",
    frequency: "monthly",
    aggregation: "Monthly mean of the model's 3-hourly instantaneous soil water content.",
    words: { en: ["soil", "moisture", "gldas", "drought", "land", ...words] },
    phrases: { en: ["soil moisture", "soil water", ...words.map((w) => `${w} soil moisture`)] },
    role: "primary",
    verified: VERIFIED,
  };
}

export const GLDAS_VARIABLES: CatalogVariable[] = [
  layer("SoilMoi0_10cm_inst", "0–10 cm", ["surface", "topsoil"]),
  layer("SoilMoi10_40cm_inst", "10–40 cm", ["shallow"]),
  layer("SoilMoi40_100cm_inst", "40–100 cm", ["deep"]),
  layer("SoilMoi100_200cm_inst", "100–200 cm", ["deepest"]),
  {
    key: "gldas.RootMoist_inst",
    source: "gldas",
    collection: "GLDAS_NOAH025_M",
    dapName: "RootMoist_inst",
    name: { en: "Root-zone soil moisture (GLDAS Noah)" },
    description: {
      en: "Water available to plant roots in the model's root zone (kg/m² = mm of water). Land cells only.",
    },
    providerLongName: "Root zone soil moisture",
    providerUnits: "kg m-2",
    fillValue: FILL,
    display: soil,
    domain: "land",
    frequency: "monthly",
    aggregation: "Monthly mean of the model's 3-hourly instantaneous root-zone soil water.",
    words: { en: ["root", "zone", "soil", "moisture", "gldas", "drought", "vegetation", "crops"] },
    phrases: { en: ["root zone soil moisture", "root-zone moisture", "agricultural drought"] },
    role: "primary",
    verified: VERIFIED,
  },
  {
    key: "gldas.Evap_tavg",
    source: "gldas",
    collection: "GLDAS_NOAH025_M",
    dapName: "Evap_tavg",
    name: { en: "Evapotranspiration (GLDAS Noah)" },
    description: {
      en: "Water returned to the atmosphere by evaporation and plant transpiration. Provider flux in kg m-2 s-1, shown as mm/day (×86,400). Land cells only.",
    },
    providerLongName: "Evapotranspiration",
    providerUnits: "kg m-2 s-1",
    fillValue: FILL,
    display: flux,
    domain: "land",
    frequency: "monthly",
    aggregation: "Monthly mean of the 3-hourly mean evapotranspiration rate.",
    words: { en: ["evapotranspiration", "evaporation", "transpiration", "gldas", "land"] },
    phrases: { en: ["evapotranspiration", "water loss to the atmosphere"] },
    role: "primary",
    verified: VERIFIED,
  },
];
