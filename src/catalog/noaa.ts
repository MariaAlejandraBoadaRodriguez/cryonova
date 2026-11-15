/**
 * NOAA NCEI Global Summary of the Month (GSOM) station observations, read
 * through the Climate Data Online (CDO) web services v2.
 *
 * Datatype ids and names come from the live /datatypes?datasetid=GSOM listing
 * (93 datatypes) on 2026-11-15; values are requested with units=metric (°C and
 * mm), checked against a live sample (Bogotá El Dorado, PRCP 2015-01 = 27.2 mm).
 * Point data: the run selects stations inside the area and keeps each
 * station's monthly series; the regional series is the mean of reporting
 * stations.
 */
import type { CatalogVariable, CollectionSpec, DisplayUnits } from "./types";

export const NOAA_COLLECTIONS: Record<string, CollectionSpec> = {
  NOAA_GSOM: {
    source: "noaa",
    shortName: "NOAA_GSOM",
    version: "CDO v2",
    conceptId: "cdo:GSOM",
    title: "NOAA NCEI Global Summary of the Month (GSOM), station observations",
    fieldCount: 93,
    // Station data have no grid; this nominal 1° grid is only used for request sizing.
    grid: {
      lat: { start: -90, step: 1, count: 181 },
      lon: { start: -180, step: 1, count: 361 },
      order: "lat-lon",
      latName: "latitude",
      lonName: "longitude",
      resolutionLabel: "Station observations",
    },
    temporal: { start: "1763-01", end: null },
    provider: "NOAA National Centers for Environmental Information (NCEI)",
    servedBy: "NOAA NCEI",
    citation:
      "Lawrimore, Jay H.; Ray, Ron; Applequist, Scott; Korzeniewski, Bryant; Menne, Matthew J. (2016): Global Summary of the Month (GSOM), Version 1. NOAA National Centers for Environmental Information. doi:10.7289/V5QV3JJ5. Accessed through the Climate Data Online web services v2.",
    doi: "10.7289/V5QV3JJ5",
    landingPage: "https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ncdc:C00946",
    access: "noaa-cdo",
    remote: { dataset: "GSOM" },
  },
};

const VERIFIED = { method: "CDO /datatypes?datasetid=GSOM and a units=metric data sample", date: "2026-11-15" };
const celsius: DisplayUnits = { units: "°C", scale: 1, offset: 0, trendUnits: "°C/decade", group: "temperature", decimals: 2 };

function station(dapName: string, longName: string, providerUnits: string, display: DisplayUnits, name: { en: string; es: string }, description: { en: string; es: string }, words: { en: string[]; es: string[] }, phrases: { en: string[]; es: string[] }): CatalogVariable {
  return {
    key: `noaa.${dapName}`,
    source: "noaa",
    collection: "NOAA_GSOM",
    dapName,
    name,
    description,
    providerLongName: longName,
    providerUnits,
    fillValue: Number.NaN,
    display,
    domain: "land",
    geometry: "stations",
    frequency: "monthly",
    aggregation: "GSOM monthly summary per station (NOAA NCEI); the regional series is the mean of the stations reporting that month.",
    words: { en: [...words.en, "station", "stations", "observed", "observations", "noaa", "ghcn"], es: [...words.es, "estacion", "estaciones", "observado", "observaciones", "noaa"] },
    phrases: { en: [...phrases.en, "weather station", "weather stations", "station observations", "station data"], es: [...phrases.es, "estacion meteorologica", "estaciones meteorologicas", "observaciones de estaciones"] },
    role: "primary",
    verified: VERIFIED,
  };
}

export const NOAA_VARIABLES: CatalogVariable[] = [
  station("TAVG", "Average Temperature.", "°C", celsius,
    { en: "Average temperature at weather stations (NOAA GSOM)", es: "Temperatura media en estaciones meteorológicas (NOAA GSOM)" },
    { en: "Monthly mean air temperature measured at stations inside the area (point data).", es: "Temperatura media mensual del aire medida en estaciones dentro del área (datos puntuales)." },
    { en: ["temperature", "average"], es: ["temperatura", "media"] }, { en: ["station temperature", "observed temperature"], es: ["temperatura observada"] }),
  station("TMAX", "Maximum temperature", "°C", celsius,
    { en: "Mean daily maximum temperature at stations (NOAA GSOM)", es: "Temperatura máxima diaria media en estaciones (NOAA GSOM)" },
    { en: "Monthly mean of the daily maximum temperature at stations inside the area (point data).", es: "Media mensual de la temperatura máxima diaria en estaciones dentro del área (datos puntuales)." },
    { en: ["maximum", "temperature", "heat"], es: ["maxima", "temperatura", "calor"] }, { en: ["maximum temperature"], es: ["temperatura maxima"] }),
  station("TMIN", "Minimum temperature", "°C", celsius,
    { en: "Mean daily minimum temperature at stations (NOAA GSOM)", es: "Temperatura mínima diaria media en estaciones (NOAA GSOM)" },
    { en: "Monthly mean of the daily minimum temperature at stations inside the area (point data).", es: "Media mensual de la temperatura mínima diaria en estaciones dentro del área (datos puntuales)." },
    { en: ["minimum", "temperature", "nights"], es: ["minima", "temperatura", "noches"] }, { en: ["minimum temperature"], es: ["temperatura minima"] }),
  station("PRCP", "Precipitation", "mm", { units: "mm/month", scale: 1, offset: 0, trendUnits: "mm/month per decade", group: "precip_total", decimals: 1 },
    { en: "Monthly precipitation at weather stations (NOAA GSOM)", es: "Precipitación mensual en estaciones meteorológicas (NOAA GSOM)" },
    { en: "Total precipitation measured each month at stations inside the area (point data).", es: "Precipitación total medida cada mes en estaciones dentro del área (datos puntuales)." },
    { en: ["precipitation", "rain", "rainfall", "gauge"], es: ["precipitacion", "lluvia", "pluviometro"] }, { en: ["station rainfall", "rain gauge"], es: ["lluvia observada", "pluviometros"] }),
];
