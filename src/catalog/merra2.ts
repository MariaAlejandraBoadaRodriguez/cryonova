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
  words: { en: string[]; es: string[] };
  phrases: { en: string[]; es: string[] };
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
    name: { en: "Near-surface air temperature (2 m)", es: "Temperatura del aire cerca de la superficie (2 m)" },
    description: { en: "Air temperature 2 meters above the surface.", es: "Temperatura del aire a 2 metros sobre la superficie." },
    words: { en: ["temperature", "air", "warming", "heat", "hot", "cold", "climate"], es: ["temperatura", "aire", "calentamiento", "calor", "frio", "clima"] },
    phrases: { en: ["air temperature", "near-surface air temperature", "surface air temperature", "2 m temperature", "global warming"], es: ["temperatura del aire", "temperatura superficial del aire", "temperatura cerca de la superficie", "calentamiento global"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TS", providerLongName: "surface_skin_temperature", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Surface skin temperature", es: "Temperatura de piel de la superficie" },
    description: { en: "Radiative temperature of the land, ocean or ice surface.", es: "Temperatura radiativa de la superficie de tierra, océano o hielo." },
    words: { en: ["skin", "surface", "ground", "temperature"], es: ["piel", "superficie", "suelo", "temperatura"] },
    phrases: { en: ["skin temperature", "surface temperature", "land surface temperature", "sea surface temperature"], es: ["temperatura de piel", "temperatura de la superficie", "temperatura del suelo", "temperatura superficial del mar"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "QV2M", providerLongName: "2-meter_specific_humidity", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Near-surface specific humidity (2 m)", es: "Humedad específica cerca de la superficie (2 m)" },
    description: { en: "Mass of water vapor per mass of air at 2 m.", es: "Masa de vapor de agua por masa de aire a 2 m." },
    words: { en: ["humidity", "moisture", "vapor", "humid"], es: ["humedad", "vapor", "humedo"] },
    phrases: { en: ["specific humidity", "air humidity", "water vapor near the surface"], es: ["humedad especifica", "humedad del aire", "vapor de agua"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T2MDEW", providerLongName: "dew_point_temperature_at_2_m", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Dew point temperature (2 m)", es: "Temperatura de punto de rocío (2 m)" },
    description: { en: "Temperature at which near-surface air would saturate.", es: "Temperatura a la que el aire cercano a la superficie se saturaría." },
    words: { en: ["dew", "dewpoint", "humidity", "muggy"], es: ["rocio", "humedad", "bochorno"] },
    phrases: { en: ["dew point", "dew point temperature"], es: ["punto de rocio", "temperatura de punto de rocio"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T2MWET", providerLongName: "wet_bulb_temperature_at_2_m", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Wet-bulb temperature (2 m)", es: "Temperatura de bulbo húmedo (2 m)" },
    description: { en: "Combined heat and humidity indicator relevant to heat stress.", es: "Indicador combinado de calor y humedad relevante para el estrés térmico." },
    words: { en: ["wet-bulb", "heatwave", "stress", "heat"], es: ["bulbo", "estres", "termico", "calor"] },
    phrases: { en: ["wet bulb temperature", "heat stress"], es: ["temperatura de bulbo humedo", "estres termico", "ola de calor"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "SLP", providerLongName: "sea_level_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Sea-level pressure", es: "Presión al nivel del mar" },
    description: { en: "Atmospheric pressure reduced to sea level.", es: "Presión atmosférica reducida al nivel del mar." },
    words: { en: ["pressure", "barometric", "circulation"], es: ["presion", "barometrica", "circulacion"] },
    phrases: { en: ["sea level pressure", "atmospheric pressure"], es: ["presion al nivel del mar", "presion atmosferica"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T850", providerLongName: "air_temperature_at_850_hPa", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 850 hPa", es: "Temperatura del aire a 850 hPa" },
    description: { en: "Lower-troposphere temperature (about 1.5 km altitude).", es: "Temperatura de la troposfera baja (unos 1,5 km de altitud)." },
    words: { en: ["850", "troposphere", "altitude", "upper-air"], es: ["850", "troposfera", "altitud"] },
    phrases: { en: ["850 hpa temperature", "lower troposphere temperature"], es: ["temperatura a 850 hpa", "temperatura de la troposfera baja"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T500", providerLongName: "air_temperature_at_500_hPa", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 500 hPa", es: "Temperatura del aire a 500 hPa" },
    description: { en: "Mid-troposphere temperature (about 5.5 km altitude).", es: "Temperatura de la troposfera media (unos 5,5 km de altitud)." },
    words: { en: ["500", "troposphere", "mid-level"], es: ["500", "troposfera", "media"] },
    phrases: { en: ["500 hpa temperature", "mid troposphere temperature"], es: ["temperatura a 500 hpa", "temperatura de la troposfera media"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "T250", providerLongName: "air_temperature_at_250_hPa", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 250 hPa", es: "Temperatura del aire a 250 hPa" },
    description: { en: "Upper-troposphere temperature near jet-stream level.", es: "Temperatura de la troposfera alta cerca de la corriente en chorro." },
    words: { en: ["250", "jet", "upper"], es: ["250", "chorro", "alta"] },
    phrases: { en: ["250 hpa temperature", "upper troposphere temperature"], es: ["temperatura a 250 hpa", "temperatura de la troposfera alta"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H500", providerLongName: "height_at_500_hPa", providerUnits: "m", display: units.meters,
    name: { en: "Geopotential height at 500 hPa", es: "Altura geopotencial a 500 hPa" },
    description: { en: "Height of the 500 hPa surface; tracks ridges and troughs.", es: "Altura de la superficie de 500 hPa; refleja crestas y vaguadas." },
    words: { en: ["geopotential", "height", "ridge", "trough"], es: ["geopotencial", "altura", "cresta", "vaguada"] },
    phrases: { en: ["500 hpa height", "geopotential height"], es: ["altura de 500 hpa", "altura geopotencial"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U10M", providerLongName: "10-meter_eastward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 10 m", es: "Viento zonal (este) a 10 m" },
    description: { en: "West-to-east wind component at 10 m (positive toward the east).", es: "Componente oeste-este del viento a 10 m (positiva hacia el este)." },
    words: { en: ["wind", "eastward", "zonal", "breeze"], es: ["viento", "zonal", "este", "brisa"] },
    phrases: { en: ["surface wind", "eastward wind", "zonal wind"], es: ["viento en superficie", "viento zonal", "viento del oeste"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V10M", providerLongName: "10-meter_northward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 10 m", es: "Viento meridional (norte) a 10 m" },
    description: { en: "South-to-north wind component at 10 m (positive toward the north).", es: "Componente sur-norte del viento a 10 m (positiva hacia el norte)." },
    words: { en: ["wind", "northward", "meridional"], es: ["viento", "meridional", "norte"] },
    phrases: { en: ["northward wind", "meridional wind"], es: ["viento meridional", "viento del sur"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TQV", providerLongName: "total_precipitable_water_vapor", providerUnits: "kg m-2", display: units.waterColumn,
    name: { en: "Total precipitable water vapor", es: "Vapor de agua precipitable total" },
    description: { en: "Water vapor in the full atmospheric column (1 kg/m² = 1 mm).", es: "Vapor de agua en toda la columna atmosférica (1 kg/m² = 1 mm)." },
    words: { en: ["vapor", "precipitable", "moisture", "column"], es: ["vapor", "precipitable", "humedad", "columna"] },
    phrases: { en: ["precipitable water", "water vapor", "total column water vapor"], es: ["agua precipitable", "vapor de agua", "vapor de agua en la columna"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TQL", providerLongName: "total_precipitable_liquid_water", providerUnits: "kg m-2", display: units.waterColumn,
    name: { en: "Total cloud liquid water", es: "Agua líquida total en nubes" },
    description: { en: "Liquid cloud water in the atmospheric column.", es: "Agua líquida de nubes en la columna atmosférica." },
    words: { en: ["cloud", "liquid", "droplets"], es: ["nube", "liquida", "gotas"] },
    phrases: { en: ["cloud liquid water", "liquid water path"], es: ["agua liquida de nubes", "contenido de agua liquida"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TQI", providerLongName: "total_precipitable_ice_water", providerUnits: "kg m-2", display: units.waterColumn,
    name: { en: "Total cloud ice water", es: "Hielo total en nubes" },
    description: { en: "Cloud ice in the atmospheric column.", es: "Hielo de nubes en la columna atmosférica." },
    words: { en: ["cloud", "ice", "frozen"], es: ["nube", "hielo", "congelada"] },
    phrases: { en: ["cloud ice", "ice water path"], es: ["hielo en nubes", "contenido de hielo"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TO3", providerLongName: "total_column_ozone", providerUnits: "Dobsons", display: units.dobson,
    name: { en: "Total column ozone", es: "Ozono total en columna" },
    description: { en: "Ozone in the full atmospheric column, in Dobson units.", es: "Ozono en toda la columna atmosférica, en unidades Dobson." },
    words: { en: ["ozone", "stratosphere", "uv"], es: ["ozono", "estratosfera", "uv"] },
    phrases: { en: ["ozone layer", "total ozone", "ozone hole"], es: ["capa de ozono", "ozono total", "agujero de ozono"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPT", providerLongName: "tropopause_temperature_using_blended_TROPP_estimate", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Tropopause temperature", es: "Temperatura de la tropopausa" },
    description: { en: "Temperature at the tropopause (blended estimate).", es: "Temperatura en la tropopausa (estimación combinada)." },
    words: { en: ["tropopause"], es: ["tropopausa"] },
    phrases: { en: ["tropopause temperature"], es: ["temperatura de la tropopausa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPPB", providerLongName: "tropopause_pressure_based_on_blended_estimate", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Tropopause pressure", es: "Presión de la tropopausa" },
    description: { en: "Pressure at the tropopause; lower values mean a higher tropopause.", es: "Presión en la tropopausa; valores menores indican una tropopausa más alta." },
    words: { en: ["tropopause", "height"], es: ["tropopausa", "altura"] },
    phrases: { en: ["tropopause pressure", "tropopause height"], es: ["presion de la tropopausa", "altura de la tropopausa"] },
  }),
  // Fields added from the original 22-topic catalog (docs/design/prototype/). Units and long
  // names were read from the live DAS on 2026-11-15 (docs/benchmarks/catalog-verification.md).
  variable({
    collection: "M2TMNXSLV", dapName: "T10M", providerLongName: "10-meter_air_temperature", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Air temperature at 10 m", es: "Temperatura del aire a 10 m" },
    description: { en: "Air temperature 10 m above the ground.", es: "Temperatura del aire a 10 m sobre el suelo." },
    words: { en: ["temperature", "height"], es: ["temperatura", "altura"] },
    phrases: { en: ["10 m temperature", "temperature at 10 meters", "temperature at 2 and 10 meters"], es: ["temperatura a 10 m", "temperatura a 10 metros"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Var_T2M", providerLongName: "Variance_of_T2M", providerUnits: "K K", display: units.kelvinSquared, role: "variability",
    name: { en: "Within-month variance of 2 m air temperature", es: "Varianza mensual de la temperatura del aire a 2 m" },
    description: { en: "How much 2 m air temperature varies within the month (MERRA-2 variance field).", es: "Cuánto varía la temperatura del aire a 2 m dentro del mes (campo de varianza de MERRA-2)." },
    words: { en: ["variability", "variance", "fluctuations"], es: ["variabilidad", "varianza", "fluctuaciones"] },
    phrases: { en: ["temperature variability", "temperature fluctuations within the month", "variance of air temperature"], es: ["variabilidad de la temperatura", "varianza de la temperatura del aire"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Var_TS", providerLongName: "Variance_of_TS", providerUnits: "K K", display: units.kelvinSquared, role: "variability",
    name: { en: "Within-month variance of surface skin temperature", es: "Varianza mensual de la temperatura de la superficie" },
    description: { en: "How much ground-surface temperature varies within the month (MERRA-2 variance field).", es: "Cuánto varía la temperatura de la superficie dentro del mes (campo de varianza de MERRA-2)." },
    words: { en: ["variability", "variance", "surface"], es: ["variabilidad", "varianza", "superficie"] },
    phrases: { en: ["surface temperature variability", "variance of surface temperature"], es: ["variabilidad de la temperatura de la superficie", "varianza de la temperatura de la superficie"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "QV10M", providerLongName: "10-meter_specific_humidity", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 10 m", es: "Humedad específica a 10 m" },
    description: { en: "Grams of water vapour per kilogram of air at 10 m.", es: "Gramos de vapor de agua por kilogramo de aire a 10 m." },
    words: { en: ["humidity", "vapor", "height"], es: ["humedad", "vapor", "altura"] },
    phrases: { en: ["specific humidity at 10 m", "humidity difference between two heights", "specific humidity at 2 and 10 meters"], es: ["humedad especifica a 10 m", "humedad a dos alturas"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Q850", providerLongName: "specific_humidity_at_850_hPa", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 850 hPa", es: "Humedad específica a 850 hPa" },
    description: { en: "Specific humidity at the 850 hPa level (about 1.5 km up).", es: "Humedad específica en el nivel de 850 hPa (unos 1,5 km de altura)." },
    words: { en: ["humidity", "850", "levels"], es: ["humedad", "850", "niveles"] },
    phrases: { en: ["humidity at 850 hpa", "humidity by pressure level"], es: ["humedad a 850 hpa", "humedad por nivel de presion"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Q500", providerLongName: "specific_humidity_at_500_hPa", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 500 hPa", es: "Humedad específica a 500 hPa" },
    description: { en: "Specific humidity at the 500 hPa level (about 5.5 km up).", es: "Humedad específica en el nivel de 500 hPa (unos 5,5 km de altura)." },
    words: { en: ["humidity", "500", "midlevel"], es: ["humedad", "500", "media"] },
    phrases: { en: ["humidity at 500 hpa", "midlevel humidity"], es: ["humedad a 500 hpa", "humedad en niveles medios"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "Q250", providerLongName: "specific_humidity_at_250_hPa", providerUnits: "kg kg-1", display: units.kgkgToGkg,
    name: { en: "Specific humidity at 250 hPa", es: "Humedad específica a 250 hPa" },
    description: { en: "Specific humidity at the 250 hPa level (about 10 km up).", es: "Humedad específica en el nivel de 250 hPa (unos 10 km de altura)." },
    words: { en: ["humidity", "250", "upper"], es: ["humedad", "250", "alta"] },
    phrases: { en: ["humidity at 250 hpa", "upper-air humidity"], es: ["humedad a 250 hpa", "humedad en altura"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "CLDTMP", providerLongName: "cloud_top_temperature", providerUnits: "K", display: units.kelvinToC,
    name: { en: "Cloud-top temperature", es: "Temperatura de la cima de las nubes" },
    description: { en: "Temperature at the top of the clouds.", es: "Temperatura en la cima de las nubes." },
    words: { en: ["cloud", "clouds", "top"], es: ["nube", "nubes", "cima"] },
    phrases: { en: ["cloud top temperature", "cloud top temperature and pressure"], es: ["temperatura de la cima de las nubes"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "CLDPRS", providerLongName: "cloud_top_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Cloud-top pressure", es: "Presión de la cima de las nubes" },
    description: { en: "Air pressure at the top of the clouds; lower values mean higher cloud tops.", es: "Presión del aire en la cima de las nubes; valores menores indican nubes más altas." },
    words: { en: ["cloud", "clouds", "condensate"], es: ["nube", "nubes", "condensado"] },
    phrases: { en: ["cloud top pressure", "cloud top height"], es: ["presion de la cima de las nubes", "altura de las nubes"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "PS", providerLongName: "surface_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Surface pressure", es: "Presión en superficie" },
    description: { en: "Air pressure at the ground.", es: "Presión del aire en el suelo." },
    words: { en: ["pressure", "surface", "barometer"], es: ["presion", "superficie", "barometro"] },
    phrases: { en: ["surface pressure", "air pressure at the ground"], es: ["presion en superficie", "presion del aire en el suelo"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U2M", providerLongName: "2-meter_eastward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 2 m", es: "Viento zonal (este) a 2 m" },
    description: { en: "Eastward wind at 2 m (positive toward the east).", es: "Viento hacia el este a 2 m (positivo hacia el este)." },
    words: { en: ["wind", "components", "direction"], es: ["viento", "componentes", "direccion"] },
    phrases: { en: ["wind at 2 m", "mean wind at 2 meters", "wind components at 2 m"], es: ["viento a 2 m", "viento medio a 2 metros"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V2M", providerLongName: "2-meter_northward_wind", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 2 m", es: "Viento meridional (norte) a 2 m" },
    description: { en: "Northward wind at 2 m (positive toward the north).", es: "Viento hacia el norte a 2 m (positivo hacia el norte)." },
    words: { en: ["wind", "components", "direction"], es: ["viento", "componentes", "direccion"] },
    phrases: { en: ["northward wind at 2 m", "wind components at 2 m"], es: ["viento meridional a 2 m"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U50M", providerLongName: "eastward_wind_at_50_meters", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 50 m", es: "Viento zonal (este) a 50 m" },
    description: { en: "Eastward wind at 50 m.", es: "Viento hacia el este a 50 m." },
    words: { en: ["wind", "shear", "height"], es: ["viento", "cizalladura", "altura"] },
    phrases: { en: ["wind at 50 m", "wind at 10 and 50 meters", "wind difference between two heights"], es: ["viento a 50 m", "viento a 10 y 50 metros"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V50M", providerLongName: "northward_wind_at_50_meters", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 50 m", es: "Viento meridional (norte) a 50 m" },
    description: { en: "Northward wind at 50 m.", es: "Viento hacia el norte a 50 m." },
    words: { en: ["wind", "shear", "height"], es: ["viento", "cizalladura", "altura"] },
    phrases: { en: ["northward wind at 50 m"], es: ["viento meridional a 50 m"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U850", providerLongName: "eastward_wind_at_850_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 850 hPa", es: "Viento zonal (este) a 850 hPa" },
    description: { en: "Eastward wind at the 850 hPa level (about 1.5 km up).", es: "Viento hacia el este en el nivel de 850 hPa (unos 1,5 km)." },
    words: { en: ["wind", "850", "shear"], es: ["viento", "850", "cizalladura"] },
    phrases: { en: ["wind at 850 hpa", "upper air wind", "wind shear between pressure levels"], es: ["viento a 850 hpa", "viento en altura"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V850", providerLongName: "northward_wind_at_850_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 850 hPa", es: "Viento meridional (norte) a 850 hPa" },
    description: { en: "Northward wind at the 850 hPa level (about 1.5 km up).", es: "Viento hacia el norte en el nivel de 850 hPa (unos 1,5 km)." },
    words: { en: ["wind", "850"], es: ["viento", "850"] },
    phrases: { en: ["northward wind at 850 hpa"], es: ["viento meridional a 850 hpa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U500", providerLongName: "eastward_wind_at_500_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 500 hPa", es: "Viento zonal (este) a 500 hPa" },
    description: { en: "Eastward wind at the 500 hPa level (about 5.5 km up).", es: "Viento hacia el este en el nivel de 500 hPa (unos 5,5 km)." },
    words: { en: ["wind", "500", "circulation"], es: ["viento", "500", "circulacion"] },
    phrases: { en: ["wind at 500 hpa", "midlevel wind", "midlevel atmospheric circulation"], es: ["viento a 500 hpa", "viento en niveles medios"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V500", providerLongName: "northward_wind_at_500_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 500 hPa", es: "Viento meridional (norte) a 500 hPa" },
    description: { en: "Northward wind at the 500 hPa level (about 5.5 km up).", es: "Viento hacia el norte en el nivel de 500 hPa (unos 5,5 km)." },
    words: { en: ["wind", "500", "circulation"], es: ["viento", "500", "circulacion"] },
    phrases: { en: ["northward wind at 500 hpa"], es: ["viento meridional a 500 hpa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "U250", providerLongName: "eastward_wind_at_250_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Eastward wind at 250 hPa", es: "Viento zonal (este) a 250 hPa" },
    description: { en: "Eastward wind at the 250 hPa level (about 10 km up, jet-stream level).", es: "Viento hacia el este en el nivel de 250 hPa (unos 10 km, nivel de la corriente en chorro)." },
    words: { en: ["wind", "250", "jet"], es: ["viento", "250", "chorro"] },
    phrases: { en: ["wind at 250 hpa", "jet stream wind"], es: ["viento a 250 hpa", "corriente en chorro"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "V250", providerLongName: "northward_wind_at_250_hPa", providerUnits: "m s-1", display: units.wind,
    name: { en: "Northward wind at 250 hPa", es: "Viento meridional (norte) a 250 hPa" },
    description: { en: "Northward wind at the 250 hPa level (about 10 km up).", es: "Viento hacia el norte en el nivel de 250 hPa (unos 10 km)." },
    words: { en: ["wind", "250"], es: ["viento", "250"] },
    phrases: { en: ["northward wind at 250 hpa"], es: ["viento meridional a 250 hpa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H1000", providerLongName: "height_at_1000_mb", providerUnits: "m", display: units.meters,
    name: { en: "Height of the 1000 hPa level", es: "Altura del nivel de 1000 hPa" },
    description: { en: "Height of the 1000 hPa pressure level.", es: "Altura del nivel de presión de 1000 hPa." },
    words: { en: ["thickness", "geopotential", "layers"], es: ["espesor", "geopotencial", "capas"] },
    phrases: { en: ["1000 hpa height", "atmospheric layer thickness"], es: ["altura de 1000 hpa", "espesor de capas atmosfericas"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H850", providerLongName: "height_at_850_hPa", providerUnits: "m", display: units.meters,
    name: { en: "Height of the 850 hPa level", es: "Altura del nivel de 850 hPa" },
    description: { en: "Height of the 850 hPa pressure level.", es: "Altura del nivel de presión de 850 hPa." },
    words: { en: ["thickness", "geopotential", "850"], es: ["espesor", "geopotencial", "850"] },
    phrases: { en: ["850 hpa height", "vertical distance between pressure levels"], es: ["altura de 850 hpa", "distancia vertical entre niveles de presion"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "H250", providerLongName: "height_at_250_hPa", providerUnits: "m", display: units.meters,
    name: { en: "Height of the 250 hPa level", es: "Altura del nivel de 250 hPa" },
    description: { en: "Height of the 250 hPa pressure level.", es: "Altura del nivel de presión de 250 hPa." },
    words: { en: ["thickness", "geopotential", "250"], es: ["espesor", "geopotencial", "250"] },
    phrases: { en: ["250 hpa height"], es: ["altura de 250 hpa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "OMEGA500", providerLongName: "omega_at_500_hPa", providerUnits: "Pa s-1", display: units.omega,
    name: { en: "Vertical motion at 500 hPa (omega)", es: "Movimiento vertical a 500 hPa (omega)" },
    description: { en: "Up-and-down air motion at the 500 hPa level; negative means rising air.", es: "Movimiento vertical del aire en el nivel de 500 hPa; negativo significa aire ascendente." },
    words: { en: ["omega", "ascent", "descent", "vertical"], es: ["omega", "ascenso", "descenso", "vertical"] },
    phrases: { en: ["vertical motion", "rising and sinking air at 500 hpa", "midlevel vertical motion and humidity"], es: ["movimiento vertical", "aire ascendente y descendente"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "PBLTOP", providerLongName: "pbltop_pressure", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Pressure at the boundary-layer top", es: "Presión en la cima de la capa límite" },
    description: { en: "Air pressure at the top of the lowest, well-mixed layer of air.", es: "Presión del aire en la cima de la capa de aire más baja y bien mezclada." },
    words: { en: ["boundary", "pressure", "mixing"], es: ["limite", "presion", "mezcla"] },
    phrases: { en: ["boundary layer top", "pressure difference from surface to boundary layer top"], es: ["cima de la capa limite"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "ZLCL", providerLongName: "lifting_condensation_level", providerUnits: "m", display: units.meters,
    name: { en: "Lifting condensation level", es: "Nivel de condensación por ascenso" },
    description: { en: "Height at which rising air starts to form cloud.", es: "Altura a la que el aire que asciende empieza a formar nubes." },
    words: { en: ["condensation", "cloud", "base"], es: ["condensacion", "nube", "base"] },
    phrases: { en: ["lifting condensation level", "condensation height", "cloud base height"], es: ["nivel de condensacion", "altura de condensacion", "base de las nubes"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "DISPH", providerLongName: "zero_plane_displacement_height", providerUnits: "m", display: units.meters,
    name: { en: "Zero-plane displacement height", es: "Altura de desplazamiento del plano cero" },
    description: { en: "A model setting for how rough the surface is (MERRA-2 surface parameter).", es: "Un parámetro del modelo que describe la rugosidad de la superficie (MERRA-2)." },
    words: { en: ["displacement", "roughness", "surface"], es: ["desplazamiento", "rugosidad", "superficie"] },
    phrases: { en: ["zero plane displacement height", "model surface parameter"], es: ["altura de desplazamiento", "parametro de superficie del modelo"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPPT", providerLongName: "tropopause_pressure_based_on_thermal_estimate", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Tropopause pressure (thermal estimate)", es: "Presión de la tropopausa (estimación térmica)" },
    description: { en: "Pressure at the tropopause, from the temperature profile.", es: "Presión en la tropopausa, según el perfil de temperatura." },
    words: { en: ["tropopause", "thermal"], es: ["tropopausa", "termica"] },
    phrases: { en: ["thermal tropopause", "tropopause pressure across different methods"], es: ["tropopausa termica"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPPV", providerLongName: "tropopause_pressure_based_on_EPV_estimate", providerUnits: "Pa", display: units.paToHpa,
    name: { en: "Tropopause pressure (potential vorticity estimate)", es: "Presión de la tropopausa (estimación por vorticidad potencial)" },
    description: { en: "Pressure at the tropopause, from potential vorticity.", es: "Presión en la tropopausa, según la vorticidad potencial." },
    words: { en: ["tropopause", "vorticity"], es: ["tropopausa", "vorticidad"] },
    phrases: { en: ["dynamical tropopause", "potential vorticity tropopause"], es: ["tropopausa dinamica"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TROPQ", providerLongName: "tropopause_specific_humidity_using_blended_TROPP_estimate", providerUnits: "kg kg-1", display: units.kgkgToMgkg,
    name: { en: "Tropopause specific humidity", es: "Humedad específica en la tropopausa" },
    description: { en: "Specific humidity at the tropopause (blended estimate).", es: "Humedad específica en la tropopausa (estimación combinada)." },
    words: { en: ["tropopause", "humidity"], es: ["tropopausa", "humedad"] },
    phrases: { en: ["tropopause humidity", "tropopause temperature and humidity"], es: ["humedad en la tropopausa"] },
  }),
  variable({
    collection: "M2TMNXSLV", dapName: "TOX", providerLongName: "total_column_odd_oxygen", providerUnits: "kg m-2", display: units.columnMassG,
    name: { en: "Total column odd oxygen", es: "Oxígeno impar total en columna" },
    description: { en: "Total odd oxygen (ozone plus atomic oxygen) in the column of air.", es: "Oxígeno impar total (ozono más oxígeno atómico) en la columna de aire." },
    words: { en: ["oxygen", "ozone", "column"], es: ["oxigeno", "ozono", "columna"] },
    phrases: { en: ["odd oxygen", "total column odd oxygen"], es: ["oxigeno impar", "oxigeno impar en columna"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "PRECTOTCORR", providerLongName: "total_precipitation", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay,
    name: { en: "Total precipitation (bias-corrected)", es: "Precipitación total (corregida)" },
    description: { en: "Precipitation rate corrected with observations; shown as mm/day.", es: "Tasa de precipitación corregida con observaciones; se muestra en mm/día." },
    words: { en: ["precipitation", "rain", "rainfall", "drought", "wet"], es: ["precipitacion", "lluvia", "sequia", "lluvias"] },
    phrases: { en: ["total precipitation", "rainfall rate", "rainy season"], es: ["precipitacion total", "cantidad de lluvia", "temporada de lluvias"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "PRECSNO", providerLongName: "snowfall", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay,
    name: { en: "Snowfall (water equivalent)", es: "Nevadas (equivalente en agua)" },
    description: { en: "Snowfall rate as liquid water equivalent, shown as mm/day.", es: "Tasa de nevada como equivalente en agua líquida, en mm/día." },
    words: { en: ["snowfall", "snow", "blizzard"], es: ["nevada", "nieve", "nevadas"] },
    phrases: { en: ["snowfall rate", "snow precipitation"], es: ["tasa de nevada", "precipitacion de nieve"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "EVAP", providerLongName: "evaporation_from_turbulence", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay,
    name: { en: "Evaporation", es: "Evaporación" },
    description: { en: "Surface evaporation rate, shown as mm/day.", es: "Tasa de evaporación en superficie, en mm/día." },
    words: { en: ["evaporation", "evapotranspiration", "drying"], es: ["evaporacion", "evapotranspiracion", "secado"] },
    phrases: { en: ["surface evaporation", "water loss"], es: ["evaporacion superficial", "perdida de agua"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "HFLUX", providerLongName: "sensible_heat_flux_from_turbulence", providerUnits: "W m-2", display: units.wm2,
    name: { en: "Sensible heat flux", es: "Flujo de calor sensible" },
    description: { en: "Turbulent heat transfer from surface to air (positive upward).", es: "Transferencia turbulenta de calor de la superficie al aire (positiva hacia arriba)." },
    words: { en: ["sensible", "flux", "energy"], es: ["sensible", "flujo", "energia"] },
    phrases: { en: ["sensible heat flux", "surface heat flux"], es: ["flujo de calor sensible", "flujo de calor superficial"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "EFLUX", providerLongName: "total_latent_energy_flux", providerUnits: "W m-2", display: units.wm2,
    name: { en: "Latent heat flux", es: "Flujo de calor latente" },
    description: { en: "Energy used by evaporation (positive upward).", es: "Energía usada por la evaporación (positiva hacia arriba)." },
    words: { en: ["latent", "flux", "energy"], es: ["latente", "flujo", "energia"] },
    phrases: { en: ["latent heat flux"], es: ["flujo de calor latente"] },
  }),
  variable({
    collection: "M2TMNXFLX", dapName: "PBLH", providerLongName: "planetary_boundary_layer_height", providerUnits: "m", display: units.meters,
    name: { en: "Planetary boundary layer height", es: "Altura de la capa límite planetaria" },
    description: { en: "Depth of the turbulent layer next to the surface.", es: "Espesor de la capa turbulenta junto a la superficie." },
    words: { en: ["boundary", "mixing", "pbl"], es: ["capa", "limite", "mezcla"] },
    phrases: { en: ["boundary layer height", "mixing height"], es: ["altura de la capa limite", "altura de mezcla"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "GWETTOP", providerLongName: "surface_soil_wetness", providerUnits: "1", display: units.fraction, domain: "land",
    name: { en: "Surface soil wetness", es: "Humedad superficial del suelo" },
    description: { en: "Degree of saturation of the top soil layer (0 dry to 1 saturated). Land only.", es: "Grado de saturación de la capa superior del suelo (0 seco a 1 saturado). Solo tierra." },
    words: { en: ["soil", "moisture", "wetness", "drought", "dry"], es: ["suelo", "humedad", "sequia", "seco"] },
    phrases: { en: ["soil moisture", "surface soil moisture", "soil wetness"], es: ["humedad del suelo", "humedad superficial del suelo"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "GWETROOT", providerLongName: "root_zone_soil_wetness", providerUnits: "1", display: units.fraction, domain: "land",
    name: { en: "Root-zone soil wetness", es: "Humedad del suelo en la zona radicular" },
    description: { en: "Degree of saturation of the root zone (0 to 1). Land only.", es: "Grado de saturación de la zona radicular (0 a 1). Solo tierra." },
    words: { en: ["root", "soil", "moisture", "agriculture"], es: ["raiz", "suelo", "humedad", "agricultura"] },
    phrases: { en: ["root zone soil moisture"], es: ["humedad de la zona radicular"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "SNOMAS", providerLongName: "Total_snow_storage_land", providerUnits: "kg m-2", display: units.snowMass, domain: "land",
    name: { en: "Snow mass on land", es: "Masa de nieve en tierra" },
    description: { en: "Snow water equivalent stored on land (1 kg/m² = 1 mm). Land only.", es: "Equivalente en agua de la nieve almacenada en tierra (1 kg/m² = 1 mm). Solo tierra." },
    words: { en: ["snowpack", "snow", "glacier", "mountains"], es: ["nieve", "manto", "nevados", "montanas"] },
    phrases: { en: ["snow water equivalent", "snow mass", "snow cover"], es: ["equivalente de agua de nieve", "masa de nieve", "cobertura de nieve"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "FRSNO", providerLongName: "fractional_area_of_land_snowcover", providerUnits: "1", display: units.percent, domain: "land",
    name: { en: "Snow-covered land fraction", es: "Fracción de tierra cubierta de nieve" },
    description: { en: "Share of land area covered by snow, shown as percent. Land only.", es: "Porción del área terrestre cubierta de nieve, en porcentaje. Solo tierra." },
    words: { en: ["snowcover", "snow", "white"], es: ["nieve", "cobertura", "blanca"] },
    phrases: { en: ["snow cover fraction", "snow covered area"], es: ["fraccion de cobertura de nieve", "area cubierta de nieve"] },
  }),
  variable({
    collection: "M2TMNXLND", dapName: "RUNOFF", providerLongName: "overland_runoff_including_throughflow", providerUnits: "kg m-2 s-1", display: units.fluxToMmDay, domain: "land",
    name: { en: "Surface runoff", es: "Escorrentía superficial" },
    description: { en: "Overland runoff rate, shown as mm/day. Land only.", es: "Tasa de escorrentía superficial, en mm/día. Solo tierra." },
    words: { en: ["runoff", "flood", "streamflow", "hydrology"], es: ["escorrentia", "inundacion", "caudal", "hidrologia"] },
    phrases: { en: ["surface runoff", "river flow"], es: ["escorrentia superficial", "caudal de rios"] },
  }),
  variable({
    collection: "M2TMNXRAD", dapName: "SWGDN", providerLongName: "surface_incoming_shortwave_flux", providerUnits: "W m-2", display: units.wm2,
    name: { en: "Incoming solar radiation at the surface", es: "Radiación solar incidente en superficie" },
    description: { en: "Downward shortwave (solar) flux reaching the surface.", es: "Flujo de onda corta (solar) que llega a la superficie." },
    words: { en: ["solar", "sunlight", "radiation", "brightening", "dimming"], es: ["solar", "luz", "radiacion", "brillo"] },
    phrases: { en: ["solar radiation", "surface shortwave radiation"], es: ["radiacion solar", "radiacion de onda corta"] },
  }),
  variable({
    collection: "M2TMNXRAD", dapName: "CLDTOT", providerLongName: "total_cloud_area_fraction", providerUnits: "1", display: units.percent,
    name: { en: "Total cloud cover", es: "Cobertura total de nubes" },
    description: { en: "Fraction of the sky covered by clouds, shown as percent.", es: "Fracción del cielo cubierta por nubes, en porcentaje." },
    words: { en: ["cloud", "cloudiness", "overcast"], es: ["nubes", "nubosidad", "nublado"] },
    phrases: { en: ["cloud cover", "cloud fraction"], es: ["cobertura de nubes", "fraccion de nubes"] },
  }),
  variable({
    collection: "M2TMNXAER", dapName: "TOTEXTTAU", providerLongName: "Total Aerosol Extinction AOT [550 nm]", providerUnits: "1", display: units.aod,
    name: { en: "Aerosol optical depth (550 nm)", es: "Profundidad óptica de aerosoles (550 nm)" },
    description: { en: "Total aerosol extinction; higher means hazier air.", es: "Extinción total por aerosoles; valores altos indican aire más turbio." },
    words: { en: ["aerosol", "haze", "pollution", "smoke", "aod"], es: ["aerosoles", "bruma", "contaminacion", "humo"] },
    phrases: { en: ["aerosol optical depth", "air pollution", "wildfire smoke"], es: ["profundidad optica de aerosoles", "contaminacion del aire", "humo de incendios"] },
  }),
  variable({
    collection: "M2TMNXAER", dapName: "DUEXTTAU", providerLongName: "Dust Extinction AOT [550 nm]", providerUnits: "1", display: units.aod,
    name: { en: "Dust optical depth (550 nm)", es: "Profundidad óptica de polvo (550 nm)" },
    description: { en: "Aerosol extinction due to mineral dust.", es: "Extinción por aerosoles de polvo mineral." },
    words: { en: ["dust", "sand", "sahara"], es: ["polvo", "arena", "sahara"] },
    phrases: { en: ["dust storms", "saharan dust", "mineral dust"], es: ["tormentas de polvo", "polvo del sahara", "polvo mineral"] },
  }),
];
