/**
 * MERRA-2 monthly 2D collections and variables.
 *
 * Every collection, field count, variable name, unit and fill value below was
 * read from the live OPeNDAP DDS/DAS of a granule on 2026-11-14 (see
 * docs/benchmarks/catalog-verification.md). Display conversions are exact unit
 * conversions; they never change the provider value used for statistics.
 */
import type { CatalogVariable, CollectionSpec, DisplayUnits, Domain, GridSpec, Localized } from "./types";

const MERRA2_GRID: GridSpec = {
  lat: { start: -90, step: 0.5, count: 361 },
  lon: { start: -180, step: 0.625, count: 576 },
  order: "lat-lon",
  latName: "lat",
  lonName: "lon",
  resolutionLabel: "0.5° lat × 0.625° lon",
};

const CITATION =
  "Global Modeling and Assimilation Office (GMAO) (2015), MERRA-2, Greenbelt, MD, USA, Goddard Earth Sciences Data and Information Services Center (GES DISC).";

function collection(shortName: string, conceptId: string, fieldCount: number, title: string, doi: string): CollectionSpec {
  return {
    source: "merra2",
    shortName,
    version: "5.12.4",
    conceptId,
    title,
    fieldCount,
    grid: MERRA2_GRID,
    temporal: { start: "1980-01", end: null },
    provider: "NASA GMAO / GES DISC",
    citation: `${CITATION} ${title}. doi:${doi}`,
    doi,
    landingPage: `https://disc.gsfc.nasa.gov/datasets/${shortName}_5.12.4/summary`,
  };
}

export const MERRA2_COLLECTIONS: Record<string, CollectionSpec> = {
  M2TMNXSLV: collection("M2TMNXSLV", "C1276812859-GES_DISC", 94, "tavgM_2d_slv_Nx: Single-Level Diagnostics, monthly mean", "10.5067/AP1B0BA5PD2K"),
  M2TMNXFLX: collection("M2TMNXFLX", "C1276812868-GES_DISC", 92, "tavgM_2d_flx_Nx: Surface Flux Diagnostics, monthly mean", "10.5067/0JRLVL8YV2Y4"),
  M2TMNXLND: collection("M2TMNXLND", "C1276812856-GES_DISC", 100, "tavgM_2d_lnd_Nx: Land Surface Diagnostics, monthly mean", "10.5067/8S35XF81C28F"),
  M2TMNXRAD: collection("M2TMNXRAD", "C1276812858-GES_DISC", 72, "tavgM_2d_rad_Nx: Radiation Diagnostics, monthly mean", "10.5067/OU3HJDS973O0"),
  M2TMNXAER: collection("M2TMNXAER", "C1276812866-GES_DISC", 100, "tavgM_2d_aer_Nx: Aerosol Diagnostics, monthly mean", "10.5067/FH9A0MLJPC7N"),
};

const FILL = 9.99999987e14;
const VERIFIED = { method: "OPeNDAP DDS/DAS of granule 2010-06 (2005-01 for SLV)", date: "2026-11-14" };

const units = {
  kelvinToC: { units: "°C", scale: 1, offset: -273.15, trendUnits: "°C/decade", group: "temperature", decimals: 2 },
  fluxToMmDay: { units: "mm/day", scale: 86400, offset: 0, trendUnits: "mm/day per decade", group: "precip_rate", decimals: 3 },
  paToHpa: { units: "hPa", scale: 0.01, offset: 0, trendUnits: "hPa/decade", group: "pressure", decimals: 2 },
  kgkgToGkg: { units: "g/kg", scale: 1000, offset: 0, trendUnits: "g/kg per decade", group: "specific_humidity", decimals: 3 },
  waterColumn: { units: "mm", scale: 1, offset: 0, trendUnits: "mm/decade", group: "water_column", decimals: 3 },
  wind: { units: "m/s", scale: 1, offset: 0, trendUnits: "m/s per decade", group: "wind", decimals: 3 },
  wm2: { units: "W/m²", scale: 1, offset: 0, trendUnits: "W/m² per decade", group: "energy_flux", decimals: 2 },
  fraction: { units: "fraction (0–1)", scale: 1, offset: 0, trendUnits: "per decade", group: "fraction", decimals: 4 },
  percent: { units: "%", scale: 100, offset: 0, trendUnits: "percentage points/decade", group: "percent", decimals: 2 },
  aod: { units: "AOD (unitless)", scale: 1, offset: 0, trendUnits: "AOD per decade", group: "optical_depth", decimals: 4 },
  meters: { units: "m", scale: 1, offset: 0, trendUnits: "m/decade", group: "height", decimals: 1 },
  dobson: { units: "DU", scale: 1, offset: 0, trendUnits: "DU/decade", group: "ozone", decimals: 2 },
  snowMass: { units: "mm w.e.", scale: 1, offset: 0, trendUnits: "mm w.e./decade", group: "snow_mass", decimals: 2 },
  kelvinSquared: { units: "K²", scale: 1, offset: 0, trendUnits: "K² per decade", group: "temperature_variance", decimals: 3 },
  omega: { units: "Pa/s", scale: 1, offset: 0, trendUnits: "Pa/s per decade", group: "vertical_velocity", decimals: 4 },
  columnMassG: { units: "g/m²", scale: 1000, offset: 0, trendUnits: "g/m² per decade", group: "column_mass", decimals: 3 },
  kgkgToMgkg: { units: "mg/kg", scale: 1e6, offset: 0, trendUnits: "mg/kg per decade", group: "trace_humidity", decimals: 2 },
} satisfies Record<string, DisplayUnits>;

interface VariableInput {
  collection: keyof typeof MERRA2_COLLECTIONS;
  dapName: string;
  name: Localized;
  description: Localized;
  providerLongName: string;
  providerUnits: string;
  display: DisplayUnits;
  domain?: Domain;
  words: { en: string[] };
  phrases: { en: string[] };
  role?: CatalogVariable["role"];
}

function variable(input: VariableInput): CatalogVariable {
  return {
    key: `merra2.${input.dapName}`,
    source: "merra2",
    collection: input.collection,
    dapName: input.dapName,
    name: input.name,
    description: input.description,
    providerLongName: input.providerLongName,
    providerUnits: input.providerUnits,
    fillValue: FILL,
    display: input.display,
    domain: input.domain ?? "global",
    frequency: "monthly",
    aggregation: "Monthly mean of hourly model output (time-averaged product).",
    words: input.words,
    phrases: input.phrases,
    role: input.role ?? "primary",
    verified: VERIFIED,
  };
}

export const MERRA2_VARIABLES: CatalogVariable[] = [
  variable({
    collection: "M2TMNXSLV", dapName: "T2M", providerLongName: "2-meter_air_temperature", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Near-surface air temperature (2 m)" },
    description: { en: "Air temperature 2 meters above the surface." },
    words: { en: ["temperature", "air", "warming", "heat", "hot", "cold", "climate"] },
    phrases: { en: ["air temperature", "near-surface air temperature", "surface air temperature", "2 m temperature", "global warming"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TS", providerLongName: "surface_skin_temperature", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Surface skin temperature" },
    description: { en: "Radiative temperature of the land, ocean or ice surface." },
    words: { en: ["skin", "surface", "ground", "temperature"] },
    phrases: { en: ["skin temperature", "surface temperature", "land surface temperature", "sea surface temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "QV2M", providerLongName: "2-meter_specific_humidity", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Near-surface specific humidity (2 m)" },
    description: { en: "Mass of water vapor per mass of air at 2 m." },
    words: { en: ["humidity", "moisture", "vapor", "humid"] },
    phrases: { en: ["specific humidity", "air humidity", "water vapor near the surface"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T2MDEW", providerLongName: "dew_point_temperature_at_2_m", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Dew point temperature (2 m)" },
    description: { en: "Temperature at which near-surface air would saturate." },
    words: { en: ["dew", "dewpoint", "humidity", "muggy"] },
    phrases: { en: ["dew point", "dew point temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T2MWET", providerLongName: "wet_bulb_temperature_at_2_m", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Wet-bulb temperature (2 m)" },
    description: { en: "Combined heat and humidity indicator relevant to heat stress." },
    words: { en: ["wet-bulb", "heatwave", "stress", "heat"] },
    phrases: { en: ["wet bulb temperature", "heat stress"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "SLP", providerLongName: "sea_level_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Sea-level pressure" },
    description: { en: "Atmospheric pressure reduced to sea level." },
    words: { en: ["pressure", "barometric", "circulation"] },
    phrases: { en: ["sea level pressure", "atmospheric pressure"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T850", providerLongName: "air_temperature_at_850_hPa", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 850 hPa" },
    description: { en: "Lower-troposphere temperature (about 1.5 km altitude)." },
    words: { en: ["850", "troposphere", "altitude", "upper-air"] },
    phrases: { en: ["850 hpa temperature", "lower troposphere temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T500", providerLongName: "air_temperature_at_500_hPa", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 500 hPa" },
    description: { en: "Mid-troposphere temperature (about 5.5 km altitude)." },
    words: { en: ["500", "troposphere", "mid-level"] },
    phrases: { en: ["500 hpa temperature", "mid troposphere temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T250", providerLongName: "air_temperature_at_250_hPa", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 250 hPa" },
    description: { en: "Upper-troposphere temperature near jet-stream level." },
    words: { en: ["250", "jet", "upper"] },
    phrases: { en: ["250 hpa temperature", "upper troposphere temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H500", providerLongName: "height_at_500_hPa", providerUnits: "m", display: units.meters,
    name: { en: "Geopotential height at 500 hPa" },
    description: { en: "Height of the 500 hPa surface; tracks ridges and troughs." },
    words: { en: ["geopotential", "height", "ridge", "trough"] },
    phrases: { en: ["500 hpa height", "geopotential height"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U10M", providerLongName: "10-meter_eastward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 10 m" },
    description: { en: "West-to-east wind component at 10 m (positive toward the east)." },
    words: { en: ["wind", "eastward", "zonal", "breeze"] },
    phrases: { en: ["surface wind", "eastward wind", "zonal wind"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V10M", providerLongName: "10-meter_northward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 10 m" },
    description: { en: "South-to-north wind component at 10 m (positive toward the north)." },
    words: { en: ["wind", "northward", "meridional"] },
    phrases: { en: ["northward wind", "meridional wind"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TQV", providerLongName: "total_precipitable_water_vapor", providerUnits: "kg m-2", display: units.waterColumn,
    name: { en: "Total precipitable water vapor" },
    description: { en: "Water vapor in the full atmospheric column (1 kg/m² = 1 mm)." },
    words: { en: ["vapor", "precipitable", "moisture", "column"] },
    phrases: { en: ["precipitable water", "water vapor", "total column water vapor"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TQL", providerLongName: "total_precipitable_liquid_water", providerUnits: "kg m-2", display: units.waterColumn,
    name: { en: "Total cloud liquid water" },
    description: { en: "Liquid cloud water in the atmospheric column." },
    words: { en: ["cloud", "liquid", "droplets"] },
    phrases: { en: ["cloud liquid water", "liquid water path"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TQI", providerLongName: "total_precipitable_ice_water", providerUnits: "kg m-2", display: units.waterColumn,
    name: { en: "Total cloud ice water" },
    description: { en: "Cloud ice in the atmospheric column." },
    words: { en: ["cloud", "ice", "frozen"] },
    phrases: { en: ["cloud ice", "ice water path"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TO3", providerLongName: "total_column_ozone", providerUnits: "Dobsons", display: units.dobson,
    name: { en: "Total column ozone" },
    description: { en: "Ozone in the full atmospheric column, in Dobson units." },
    words: { en: ["ozone", "stratosphere", "uv"] },
    phrases: { en: ["ozone layer", "total ozone", "ozone hole"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPT", providerLongName: "tropopause_temperature_using_blended_TROPP_estimate", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Tropopause temperature" },
    description: { en: "Temperature at the tropopause (blended estimate)." },
    words: { en: ["tropopause"] },
    phrases: { en: ["tropopause temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPPB", providerLongName: "tropopause_pressure_based_on_blended_estimate", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Tropopause pressure" },
    description: { en: "Pressure at the tropopause; lower values mean a higher tropopause." },
    words: { en: ["tropopause", "height"] },
    phrases: { en: ["tropopause pressure", "tropopause height"] },
  }),
  // Fields added from the original 22-topic catalog (docs/design/prototype/). Units and long
  // names were read from the live DAS on 2026-11-15 (docs/benchmarks/catalog-verification.md).
  variable({
    collection: "M2TMNXSLV", dapName: "T10M", providerLongName: "10-meter_air_temperature", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 10 m" },
    description: { en: "Air temperature 10 m above the ground." },
    words: { en: ["temperature", "height"] },
    phrases: { en: ["10 m temperature", "temperature at 10 meters", "temperature at 2 and 10 meters"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Var_T2M", providerLongName: "Variance_of_T2M", providerUnits: "K K", display: units.kelvinSquared, role: "variability",
    name: { en: "Within-month variance of 2 m air temperature" },
    description: { en: "How much 2 m air temperature varies within the month (MERRA-2 variance field)." },
    words: { en: ["variability", "variance", "fluctuations"] },
    phrases: { en: ["temperature variability", "temperature fluctuations within the month", "variance of air temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Var_TS", providerLongName: "Variance_of_TS", providerUnits: "K K", display: units.kelvinSquared, role: "variability",
    name: { en: "Within-month variance of surface skin temperature" },
    description: { en: "How much ground-surface temperature varies within the month (MERRA-2 variance field)." },
    words: { en: ["variability", "variance", "surface"] },
    phrases: { en: ["surface temperature variability", "variance of surface temperature"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "QV10M", providerLongName: "10-meter_specific_humidity", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 10 m" },
    description: { en: "Grams of water vapour per kilogram of air at 10 m." },
    words: { en: ["humidity", "vapor", "height"] },
    phrases: { en: ["specific humidity at 10 m", "humidity difference between two heights", "specific humidity at 2 and 10 meters"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Q850", providerLongName: "specific_humidity_at_850_hPa", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 850 hPa" },
    description: { en: "Specific humidity at the 850 hPa level (about 1.5 km up)." },
    words: { en: ["humidity", "850", "levels"] },
    phrases: { en: ["humidity at 850 hpa", "humidity by pressure level"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Q500", providerLongName: "specific_humidity_at_500_hPa", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 500 hPa" },
    description: { en: "Specific humidity at the 500 hPa level (about 5.5 km up)." },
    words: { en: ["humidity", "500", "midlevel"] },
    phrases: { en: ["humidity at 500 hpa", "midlevel humidity"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Q250", providerLongName: "specific_humidity_at_250_hPa", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 250 hPa" },
    description: { en: "Specific humidity at the 250 hPa level (about 10 km up)." },
    words: { en: ["humidity", "250", "upper"] },
    phrases: { en: ["humidity at 250 hpa", "upper-air humidity"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "CLDTMP", providerLongName: "cloud_top_temperature", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Cloud-top temperature" },
    description: { en: "Temperature at the top of the clouds." },
    words: { en: ["cloud", "clouds", "top"] },
    phrases: { en: ["cloud top temperature", "cloud top temperature and pressure"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "CLDPRS", providerLongName: "cloud_top_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Cloud-top pressure" },
    description: { en: "Air pressure at the top of the clouds; lower values mean higher cloud tops." },
    words: { en: ["cloud", "clouds", "condensate"] },
    phrases: { en: ["cloud top pressure", "cloud top height"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "PS", providerLongName: "surface_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Surface pressure" },
    description: { en: "Air pressure at the ground." },
    words: { en: ["pressure", "surface", "barometer"] },
    phrases: { en: ["surface pressure", "air pressure at the ground"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U2M", providerLongName: "2-meter_eastward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 2 m" },
    description: { en: "Eastward wind at 2 m (positive toward the east)." },
    words: { en: ["wind", "components", "direction"] },
    phrases: { en: ["wind at 2 m", "mean wind at 2 meters", "wind components at 2 m"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V2M", providerLongName: "2-meter_northward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 2 m" },
    description: { en: "Northward wind at 2 m (positive toward the north)." },
    words: { en: ["wind", "components", "direction"] },
    phrases: { en: ["northward wind at 2 m", "wind components at 2 m"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U50M", providerLongName: "eastward_wind_at_50_meters", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 50 m" },
    description: { en: "Eastward wind at 50 m." },
    words: { en: ["wind", "shear", "height"] },
    phrases: { en: ["wind at 50 m", "wind at 10 and 50 meters", "wind difference between two heights"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V50M", providerLongName: "northward_wind_at_50_meters", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 50 m" },
    description: { en: "Northward wind at 50 m." },
    words: { en: ["wind", "shear", "height"] },
    phrases: { en: ["northward wind at 50 m"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U850", providerLongName: "eastward_wind_at_850_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 850 hPa" },
    description: { en: "Eastward wind at the 850 hPa level (about 1.5 km up)." },
    words: { en: ["wind", "850", "shear"] },
    phrases: { en: ["wind at 850 hpa", "upper air wind", "wind shear between pressure levels"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V850", providerLongName: "northward_wind_at_850_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 850 hPa" },
    description: { en: "Northward wind at the 850 hPa level (about 1.5 km up)." },
    words: { en: ["wind", "850"] },
    phrases: { en: ["northward wind at 850 hpa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U500", providerLongName: "eastward_wind_at_500_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 500 hPa" },
    description: { en: "Eastward wind at the 500 hPa level (about 5.5 km up)." },
    words: { en: ["wind", "500", "circulation"] },
    phrases: { en: ["wind at 500 hpa", "midlevel wind", "midlevel atmospheric circulation"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V500", providerLongName: "northward_wind_at_500_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 500 hPa" },
    description: { en: "Northward wind at the 500 hPa level (about 5.5 km up)." },
    words: { en: ["wind", "500", "circulation"] },
    phrases: { en: ["northward wind at 500 hpa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U250", providerLongName: "eastward_wind_at_250_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 250 hPa" },
    description: { en: "Eastward wind at the 250 hPa level (about 10 km up, jet-stream level)." },
    words: { en: ["wind", "250", "jet"] },
    phrases: { en: ["wind at 250 hpa", "jet stream wind"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V250", providerLongName: "northward_wind_at_250_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 250 hPa" },
    description: { en: "Northward wind at the 250 hPa level (about 10 km up)." },
    words: { en: ["wind", "250"] },
    phrases: { en: ["northward wind at 250 hpa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H1000", providerLongName: "height_at_1000_mb", providerUnits: "m", display: units.meters,
    name: { en: "Height of the 1000 hPa level" },
    description: { en: "Height of the 1000 hPa pressure level." },
    words: { en: ["thickness", "geopotential", "layers"] },
    phrases: { en: ["1000 hpa height", "atmospheric layer thickness"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H850", providerLongName: "height_at_850_hPa", providerUnits: "m", display: units.meters,
    name: { en: "Height of the 850 hPa level" },
    description: { en: "Height of the 850 hPa pressure level." },
    words: { en: ["thickness", "geopotential", "850"] },
    phrases: { en: ["850 hpa height", "vertical distance between pressure levels"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H250", providerLongName: "height_at_250_hPa", providerUnits: "m", display: units.meters,
    name: { en: "Height of the 250 hPa level" },
    description: { en: "Height of the 250 hPa pressure level." },
    words: { en: ["thickness", "geopotential", "250"] },
    phrases: { en: ["250 hpa height"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "OMEGA500", providerLongName: "omega_at_500_hPa", providerUnits: "Pa s-1", display: units.omega,
    name: { en: "Vertical motion at 500 hPa (omega)" },
    description: { en: "Up-and-down air motion at the 500 hPa level; negative means rising air." },
    words: { en: ["omega", "ascent", "descent", "vertical"] },
    phrases: { en: ["vertical motion", "rising and sinking air at 500 hpa", "midlevel vertical motion and humidity"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "PBLTOP", providerLongName: "pbltop_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Pressure at the boundary-layer top" },
    description: { en: "Air pressure at the top of the lowest, well-mixed layer of air." },
    words: { en: ["boundary", "pressure", "mixing"] },
    phrases: { en: ["boundary layer top", "pressure difference from surface to boundary layer top"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "ZLCL", providerLongName: "lifting_condensation_level", providerUnits: "m", display: units.meters,
    name: { en: "Lifting condensation level" },
    description: { en: "Height at which rising air starts to form cloud." },
    words: { en: ["condensation", "cloud", "base"] },
    phrases: { en: ["lifting condensation level", "condensation height", "cloud base height"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "DISPH", providerLongName: "zero_plane_displacement_height", providerUnits: "m", display: units.meters,
    name: { en: "Zero-plane displacement height" },
    description: { en: "A model setting for how rough the surface is (MERRA-2 surface parameter)." },
    words: { en: ["displacement", "roughness", "surface"] },
    phrases: { en: ["zero plane displacement height", "model surface parameter"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPPT", providerLongName: "tropopause_pressure_based_on_thermal_estimate", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Tropopause pressure (thermal estimate)" },
    description: { en: "Pressure at the tropopause, from the temperature profile." },
    words: { en: ["tropopause", "thermal"] },
    phrases: { en: ["thermal tropopause", "tropopause pressure across different methods"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPPV", providerLongName: "tropopause_pressure_based_on_EPV_estimate", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Tropopause pressure (potential vorticity estimate)" },
    description: { en: "Pressure at the tropopause, from potential vorticity." },
    words: { en: ["tropopause", "vorticity"] },
    phrases: { en: ["dynamical tropopause", "potential vorticity tropopause"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPQ", providerLongName: "tropopause_specific_humidity_using_blended_TROPP_estimate", providerUnits: "kg kg-1", display: units.kgkgToMgkg,
    name: { en: "Tropopause specific humidity" },
    description: { en: "Specific humidity at the tropopause (blended estimate)." },
    words: { en: ["tropopause", "humidity"] },
    phrases: { en: ["tropopause humidity", "tropopause temperature and humidity"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TOX", providerLongName: "total_column_odd_oxygen", providerUnits: "kg m-2", display: units.columnMassG,
    name: { en: "Total column odd oxygen" },
    description: { en: "Total odd oxygen (ozone plus atomic oxygen) in the column of air." },
    words: { en: ["oxygen", "ozone", "column"] },
    phrases: { en: ["odd oxygen", "total column odd oxygen"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "PRECTOTCORR", providerLongName: "total_precipitation", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay,
    name: { en: "Total precipitation (bias-corrected)" },
    description: { en: "Precipitation rate corrected with observations; shown as mm/day." },
    words: { en: ["precipitation", "rain", "rainfall", "drought", "wet"] },
    phrases: { en: ["total precipitation", "rainfall rate", "rainy season"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "PRECSNO", providerLongName: "snowfall", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay,
    name: { en: "Snowfall (water equivalent)" },
    description: { en: "Snowfall rate as liquid water equivalent, shown as mm/day." },
    words: { en: ["snowfall", "snow", "blizzard"] },
    phrases: { en: ["snowfall rate", "snow precipitation"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "EVAP", providerLongName: "evaporation_from_turbulence", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay,
    name: { en: "Evaporation" },
    description: { en: "Surface evaporation rate, shown as mm/day." },
    words: { en: ["evaporation", "evapotranspiration", "drying"] },
    phrases: { en: ["surface evaporation", "water loss"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "HFLUX", providerLongName: "sensible_heat_flux_from_turbulence", providerUnits: "W m-2", display: units.wm2,
    name: { en: "Sensible heat flux" },
    description: { en: "Turbulent heat transfer from surface to air (positive upward)." },
    words: { en: ["sensible", "flux", "energy"] },
    phrases: { en: ["sensible heat flux", "surface heat flux"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "EFLUX", providerLongName: "total_latent_energy_flux", providerUnits: "W m-2", display: units.wm2,
    name: { en: "Latent heat flux" },
    description: { en: "Energy used by evaporation (positive upward)." },
    words: { en: ["latent", "flux", "energy"] },
    phrases: { en: ["latent heat flux"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "PBLH", providerLongName: "planetary_boundary_layer_height", providerUnits: "m", display: units.meters,
    name: { en: "Planetary boundary layer height" },
    description: { en: "Depth of the turbulent layer next to the surface." },
    words: { en: ["boundary", "mixing", "pbl"] },
    phrases: { en: ["boundary layer height", "mixing height"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "GWETTOP", providerLongName: "surface_soil_wetness", providerUnits: "1", display: units.fraction, domain: "land",
    name: { en: "Surface soil wetness" },
    description: { en: "Degree of saturation of the top soil layer (0 dry to 1 saturated). Land only." },
    words: { en: ["soil", "moisture", "wetness", "drought", "dry"] },
    phrases: { en: ["soil moisture", "surface soil moisture", "soil wetness"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "GWETROOT", providerLongName: "root_zone_soil_wetness", providerUnits: "1", display: units.fraction, domain: "land",
    name: { en: "Root-zone soil wetness" },
    description: { en: "Degree of saturation of the root zone (0 to 1). Land only." },
    words: { en: ["root", "soil", "moisture", "agriculture"] },
    phrases: { en: ["root zone soil moisture"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "SNOMAS", providerLongName: "Total_snow_storage_land", providerUnits: "kg m-2", display: units.snowMass, domain: "land",
    name: { en: "Snow mass on land" },
    description: { en: "Snow water equivalent stored on land (1 kg/m² = 1 mm). Land only." },
    words: { en: ["snowpack", "snow", "glacier", "mountains"] },
    phrases: { en: ["snow water equivalent", "snow mass", "snow cover"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "FRSNO", providerLongName: "fractional_area_of_land_snowcover", providerUnits: "1", display: units.percent, domain: "land",
    name: { en: "Snow-covered land fraction" },
    description: { en: "Share of land area covered by snow, shown as percent. Land only." },
    words: { en: ["snowcover", "snow", "white"] },
    phrases: { en: ["snow cover fraction", "snow covered area"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "RUNOFF", providerLongName: "overland_runoff_including_throughflow", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay, domain: "land",
    name: { en: "Surface runoff" },
    description: { en: "Overland runoff rate, shown as mm/day. Land only." },
    words: { en: ["runoff", "flood", "streamflow", "hydrology"] },
    phrases: { en: ["surface runoff", "river flow"] },
  }),
  variable({
    collection: "M2TMNXRAD", dapName: "SWGDN", providerLongName: "surface_incoming_shortwave_flux", providerUnits: "W m-2", display: units.wm2,
    name: { en: "Incoming solar radiation at the surface" },
    description: { en: "Downward shortwave (solar) flux reaching the surface." },
    words: { en: ["solar", "sunlight", "radiation", "brightening", "dimming"] },
    phrases: { en: ["solar radiation", "surface shortwave radiation"] },
  }),
  variable({
    collection: "M2TMNXRAD", dapName: "CLDTOT", providerLongName: "total_cloud_area_fraction", providerUnits: "1", display: units.percent,
    name: { en: "Total cloud cover" },
    description: { en: "Fraction of the sky covered by clouds, shown as percent." },
    words: { en: ["cloud", "cloudiness", "overcast"] },
    phrases: { en: ["cloud cover", "cloud fraction"] },
  }),
  variable({
    collection: "M2TMNXAER", dapName: "TOTEXTTAU", providerLongName: "Total Aerosol Extinction AOT [550 nm]", providerUnits: "1", display: units.aod,
    name: { en: "Aerosol optical depth (550 nm)" },
    description: { en: "Total aerosol extinction; higher means hazier air." },
    words: { en: ["aerosol", "haze", "pollution", "smoke", "aod"] },
    phrases: { en: ["aerosol optical depth", "air pollution", "wildfire smoke"] },
  }),
  variable({
    collection: "M2TMNXAER", dapName: "DUEXTTAU", providerLongName: "Dust Extinction AOT [550 nm]", providerUnits: "1", display: units.aod,
    name: { en: "Dust optical depth (550 nm)" },
    description: { en: "Aerosol extinction due to mineral dust." },
    words: { en: ["dust", "sand", "sahara"] },
    phrases: { en: ["dust storms", "saharan dust", "mineral dust"] },
  }),
];
