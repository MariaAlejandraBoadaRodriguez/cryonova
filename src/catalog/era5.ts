/**
 * ERA5 monthly averaged reanalysis on single levels (Copernicus C3S, CDS
 * dataset reanalysis-era5-single-levels-monthly-means).
 *
 * Read through one asynchronous CDS retrieve job per run. Variable names,
 * units and long names below were read from the NetCDF files of a live CDS job
 * (3895ff53-a006-4649-8ca9-bce28c29908a, 2010-06, Colombia box) on 2026-11-15.
 * Coverage (1940-01 onward) and the DOI come from the CDS catalogue entry.
 * Accumulated variables (total precipitation) are mean daily accumulations
 * in metres ("avgad" step type); the rest are monthly means ("avgua").
 */
import type { CatalogVariable, CollectionSpec, DisplayUnits, Domain, Localized } from "./types";

export const ERA5_DATASET = "reanalysis-era5-single-levels-monthly-means";

export const ERA5_COLLECTIONS: Record<string, CollectionSpec> = {
  ERA5_SL_MONTHLY: {
    source: "era5",
    shortName: "ERA5_SL_MONTHLY",
    version: "CDS",
    conceptId: `cds:${ERA5_DATASET}`,
    title: "ERA5 monthly averaged data on single levels from 1940 to present",
    fieldCount: 10,
    grid: {
      lat: { start: 90, step: -0.25, count: 721 },
      lon: { start: -180, step: 0.25, count: 1440 },
      order: "lat-lon",
      latName: "latitude",
      lonName: "longitude",
      resolutionLabel: "0.25° × 0.25°",
    },
    temporal: { start: "1940-01", end: null },
    provider: "ECMWF / Copernicus Climate Change Service (C3S)",
    servedBy: "Copernicus Climate Data Store",
    citation:
      "Hersbach, H., Bell, B., Berrisford, P., et al. (2023): ERA5 monthly averaged data on single levels from 1940 to present. Copernicus Climate Change Service (C3S) Climate Data Store (CDS). doi:10.24381/cds.f17050d7 (CC-BY licence). Contains modified Copernicus Climate Change Service information.",
    doi: "10.24381/cds.f17050d7",
    landingPage: `https://cds.climate.copernicus.eu/datasets/${ERA5_DATASET}`,
    access: "cds",
    remote: { dataset: ERA5_DATASET, productType: "monthly_averaged_reanalysis" },
  },
};

const VERIFIED = { method: "NetCDF attributes of CDS job 3895ff53 (2010-06)", date: "2026-11-15" };
const kelvin: DisplayUnits = { units: "°C", scale: 1, offset: -273.15, trendUnits: "°C/decade", group: "temperature", decimals: 2 };

interface Era5Input {
  dapName: string;
  requestName: string;
  longName: string;
  providerUnits: string;
  display: DisplayUnits;
  domain?: Domain;
  name: Localized;
  description: Localized;
  aggregation?: string;
  words: { en: string[]; es: string[] };
  phrases: { en: string[]; es: string[] };
}

function era5(input: Era5Input): CatalogVariable {
  return {
    key: `era5.${input.dapName}`,
    source: "era5",
    collection: "ERA5_SL_MONTHLY",
    dapName: input.dapName,
    requestName: input.requestName,
    name: input.name,
    description: input.description,
    providerLongName: input.longName,
    providerUnits: input.providerUnits,
    fillValue: Number.NaN,
    display: input.display,
    domain: input.domain ?? "global",
    frequency: "monthly",
    aggregation: input.aggregation ?? "ERA5 monthly mean of the hourly reanalysis (monthly_averaged_reanalysis).",
    words: { en: [...input.words.en, "era5", "copernicus", "reanalysis"], es: [...input.words.es, "era5", "copernicus", "reanalisis"] },
    phrases: input.phrases,
    role: "primary",
    verified: VERIFIED,
  };
}

export const ERA5_VARIABLES: CatalogVariable[] = [
  era5({
    dapName: "t2m", requestName: "2m_temperature", longName: "2 metre temperature", providerUnits: "K", display: kelvin,
    name: { en: "Air temperature at 2 m (ERA5)", es: "Temperatura del aire a 2 m (ERA5)" },
    description: { en: "ERA5 reanalysis air temperature 2 m above the surface, shown in °C (K − 273.15).", es: "Temperatura del aire a 2 m de la superficie del reanálisis ERA5, en °C (K − 273,15)." },
    words: { en: ["temperature", "air", "warming"], es: ["temperatura", "aire", "calentamiento"] },
    phrases: { en: ["era5 temperature", "copernicus temperature"], es: ["temperatura era5"] },
  }),
  era5({
    dapName: "d2m", requestName: "2m_dewpoint_temperature", longName: "2 metre dewpoint temperature", providerUnits: "K", display: kelvin,
    name: { en: "Dew point temperature at 2 m (ERA5)", es: "Temperatura de punto de rocío a 2 m (ERA5)" },
    description: { en: "Temperature to which the air at 2 m must cool to saturate; a humidity measure. Shown in °C.", es: "Temperatura a la que el aire a 2 m se satura al enfriarse; una medida de humedad. En °C." },
    words: { en: ["dew", "dewpoint", "humidity"], es: ["rocio", "humedad"] },
    phrases: { en: ["dew point"], es: ["punto de rocio"] },
  }),
  era5({
    dapName: "skt", requestName: "skin_temperature", longName: "Skin temperature", providerUnits: "K", display: kelvin,
    name: { en: "Skin (surface) temperature (ERA5)", es: "Temperatura de piel (superficie) (ERA5)" },
    description: { en: "Temperature of the surface itself (land, sea or ice), shown in °C.", es: "Temperatura de la propia superficie (tierra, mar o hielo), en °C." },
    words: { en: ["skin", "surface", "temperature"], es: ["piel", "superficie", "temperatura"] },
    phrases: { en: ["surface temperature", "skin temperature"], es: ["temperatura de superficie"] },
  }),
  era5({
    dapName: "sst", requestName: "sea_surface_temperature", longName: "Sea surface temperature", providerUnits: "K", display: kelvin, domain: "ocean",
    name: { en: "Sea surface temperature (ERA5)", es: "Temperatura superficial del mar (ERA5)" },
    description: { en: "Temperature of the sea near the surface, shown in °C. Ocean cells only (land cells are empty).", es: "Temperatura del mar cerca de la superficie, en °C. Solo celdas oceánicas." },
    words: { en: ["sea", "ocean", "sst", "marine", "temperature"], es: ["mar", "oceano", "marina", "temperatura"] },
    phrases: { en: ["sea surface temperature", "ocean temperature", "ocean warming"], es: ["temperatura superficial del mar", "temperatura del oceano"] },
  }),
  era5({
    dapName: "msl", requestName: "mean_sea_level_pressure", longName: "Mean sea level pressure", providerUnits: "Pa", display: { units: "hPa", scale: 0.01, offset: 0, trendUnits: "hPa/decade", group: "pressure", decimals: 2 },
    name: { en: "Mean sea-level pressure (ERA5)", es: "Presión media al nivel del mar (ERA5)" },
    description: { en: "Atmospheric pressure reduced to sea level, shown in hPa (Pa × 0.01).", es: "Presión atmosférica reducida al nivel del mar, en hPa (Pa × 0,01)." },
    words: { en: ["pressure", "sea", "level"], es: ["presion", "nivel", "mar"] },
    phrases: { en: ["sea level pressure"], es: ["presion al nivel del mar"] },
  }),
  era5({
    dapName: "tp", requestName: "total_precipitation", longName: "Total precipitation", providerUnits: "m", display: { units: "mm/day", scale: 1000, offset: 0, trendUnits: "mm/day per decade", group: "precip_rate", decimals: 3 },
    name: { en: "Total precipitation (ERA5)", es: "Precipitación total (ERA5)" },
    description: { en: "Rain and snow reaching the surface. ERA5 monthly means of accumulations are mean daily totals in metres, shown as mm/day (×1000).", es: "Lluvia y nieve que llegan a la superficie. Las medias mensuales de ERA5 son totales diarios medios en metros, en mm/día (×1000)." },
    aggregation: "Mean daily accumulation over the month (ERA5 monthly averaged reanalysis, step type avgad).",
    words: { en: ["precipitation", "rain", "rainfall"], es: ["precipitacion", "lluvia"] },
    phrases: { en: ["era5 precipitation", "reanalysis rainfall"], es: ["precipitacion era5"] },
  }),
  era5({
    dapName: "tcc", requestName: "total_cloud_cover", longName: "Total cloud cover", providerUnits: "(0 - 1)", display: { units: "%", scale: 100, offset: 0, trendUnits: "percentage points/decade", group: "percent", decimals: 2 },
    name: { en: "Total cloud cover (ERA5)", es: "Nubosidad total (ERA5)" },
    description: { en: "Fraction of the sky covered by cloud at any level, shown in % (fraction × 100).", es: "Fracción del cielo cubierta por nubes en cualquier nivel, en % (fracción × 100)." },
    words: { en: ["cloud", "clouds", "cloudiness"], es: ["nubes", "nubosidad"] },
    phrases: { en: ["cloud cover"], es: ["cobertura de nubes"] },
  }),
  era5({
    dapName: "u10", requestName: "10m_u_component_of_wind", longName: "10 metre U wind component", providerUnits: "m s**-1", display: { units: "m/s", scale: 1, offset: 0, trendUnits: "m/s per decade", group: "wind", decimals: 3 },
    name: { en: "Eastward wind at 10 m (ERA5)", es: "Viento hacia el este a 10 m (ERA5)" },
    description: { en: "West-to-east wind component 10 m above the surface (negative = from the east).", es: "Componente oeste-este del viento a 10 m (negativo = desde el este)." },
    words: { en: ["wind", "eastward", "zonal"], es: ["viento", "zonal", "este"] },
    phrases: { en: ["eastward wind", "zonal wind"], es: ["viento zonal"] },
  }),
  era5({
    dapName: "v10", requestName: "10m_v_component_of_wind", longName: "10 metre V wind component", providerUnits: "m s**-1", display: { units: "m/s", scale: 1, offset: 0, trendUnits: "m/s per decade", group: "wind", decimals: 3 },
    name: { en: "Northward wind at 10 m (ERA5)", es: "Viento hacia el norte a 10 m (ERA5)" },
    description: { en: "South-to-north wind component 10 m above the surface (negative = from the north).", es: "Componente sur-norte del viento a 10 m (negativo = desde el norte)." },
    words: { en: ["wind", "northward", "meridional"], es: ["viento", "meridional", "norte"] },
    phrases: { en: ["northward wind", "meridional wind"], es: ["viento meridional"] },
  }),
  era5({
    dapName: "swvl1", requestName: "volumetric_soil_water_layer_1", longName: "Volumetric soil water layer 1", providerUnits: "m**3 m**-3", domain: "land",
    display: { units: "m³/m³", scale: 1, offset: 0, trendUnits: "m³/m³ per decade", group: "volumetric_water", decimals: 4 },
    name: { en: "Soil water 0–7 cm, volumetric (ERA5)", es: "Agua en el suelo 0–7 cm, volumétrica (ERA5)" },
    description: { en: "Volume of water per volume of soil in the top layer (0–7 cm). Land cells only.", es: "Volumen de agua por volumen de suelo en la capa superior (0–7 cm). Solo celdas de tierra." },
    words: { en: ["soil", "moisture", "water"], es: ["suelo", "humedad", "agua"] },
    phrases: { en: ["volumetric soil water", "era5 soil moisture"], es: ["humedad volumetrica del suelo"] },
  }),
];
