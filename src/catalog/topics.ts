/**
 * The 22-topic MERRA-2 analysis catalog.
 *
 * Rebuilt from live collection metadata because the original catalog file was
 * not available in the environment (decision log D-04). Each topic lists the
 * exact variables, the verified field count of its collection(s), a guiding
 * question, extra analyses and a suggested period of complete years.
 */
import type { AnalysisKind, Topic } from "./types";

const BASE: AnalysisKind[] = ["monthly_series", "annual_trend"];
const CLIMATE: AnalysisKind[] = [...BASE, "seasonal_cycle", "monthly_anomalies", "annual_ranking", "period_comparison", "seasonal_trends", "positive_streaks"];
const HYDRO: AnalysisKind[] = [...BASE, "seasonal_cycle", "monthly_anomalies", "period_comparison", "seasonal_trends"];
const FULL_PERIOD = { start: "1981-01", end: "2024-12" };
const RECENT_PERIOD = { start: "2001-01", end: "2024-12" };

function topic(input: Omit<Topic, "fieldCount"> & { fieldCount?: number }): Topic {
  const counts: Record<string, number> = { M2TMNXSLV: 94, M2TMNXFLX: 92, M2TMNXLND: 100, M2TMNXRAD: 72, M2TMNXAER: 100 };
  return { ...input, fieldCount: input.fieldCount ?? input.collections.reduce((sum, c) => sum + (counts[c] ?? 0), 0) };
}

export const TOPICS: Topic[] = [
  topic({ id: "air-temperature", collections: ["M2TMNXSLV"], variables: ["merra2.T2M"], extraAnalyses: CLIMATE, suggestedPeriod: FULL_PERIOD,
    title: { en: "Near-surface warming", es: "Calentamiento cerca de la superficie" },
    question: { en: "Has near-surface air temperature changed in this region, and by how much per decade?", es: "¿Ha cambiado la temperatura del aire cerca de la superficie en esta región y cuánto por década?" },
    words: { en: ["warming", "temperature"], es: ["calentamiento", "temperatura"] }, phrases: { en: ["global warming"], es: ["calentamiento global"] } }),
  topic({ id: "skin-temperature", collections: ["M2TMNXSLV"], variables: ["merra2.TS"], extraAnalyses: CLIMATE, suggestedPeriod: FULL_PERIOD,
    title: { en: "Surface skin temperature", es: "Temperatura de la superficie" },
    question: { en: "Is the land or sea surface heating faster than the air above it?", es: "¿Se calienta la superficie terrestre o marina más rápido que el aire sobre ella?" },
    words: { en: ["surface", "skin"], es: ["superficie", "piel"] }, phrases: { en: ["surface temperature"], es: ["temperatura de la superficie"] } }),
  topic({ id: "humidity", collections: ["M2TMNXSLV"], variables: ["merra2.QV2M"], extraAnalyses: CLIMATE, suggestedPeriod: FULL_PERIOD,
    title: { en: "Near-surface humidity", es: "Humedad cerca de la superficie" },
    question: { en: "Is the air near the surface holding more water vapor than before?", es: "¿Contiene el aire cerca de la superficie más vapor de agua que antes?" },
    words: { en: ["humidity"], es: ["humedad"] }, phrases: { en: ["air humidity"], es: ["humedad del aire"] } }),
  topic({ id: "heat-stress", collections: ["M2TMNXSLV"], variables: ["merra2.T2MDEW", "merra2.T2MWET"], extraAnalyses: CLIMATE, suggestedPeriod: FULL_PERIOD,
    title: { en: "Humid heat and heat stress", es: "Calor húmedo y estrés térmico" },
    question: { en: "Are dew point and wet-bulb temperatures rising, increasing heat stress?", es: "¿Aumentan el punto de rocío y la temperatura de bulbo húmedo, elevando el estrés térmico?" },
    words: { en: ["heatwave", "stress"], es: ["estres", "calor"] }, phrases: { en: ["heat stress"], es: ["estres termico"] } }),
  topic({ id: "sea-level-pressure", collections: ["M2TMNXSLV"], variables: ["merra2.SLP"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Sea-level pressure and circulation", es: "Presión al nivel del mar y circulación" },
    question: { en: "Has the regional sea-level pressure shifted, hinting at circulation changes?", es: "¿Ha cambiado la presión al nivel del mar, indicando cambios en la circulación?" },
    words: { en: ["pressure"], es: ["presion"] }, phrases: { en: ["sea level pressure"], es: ["presion al nivel del mar"] } }),
  topic({ id: "upper-air-temperature", collections: ["M2TMNXSLV"], variables: ["merra2.T850", "merra2.T500", "merra2.T250"], extraAnalyses: CLIMATE, suggestedPeriod: FULL_PERIOD,
    title: { en: "Temperature through the troposphere", es: "Temperatura a través de la troposfera" },
    question: { en: "Does warming change with altitude across 850, 500 and 250 hPa?", es: "¿Cambia el calentamiento con la altitud entre 850, 500 y 250 hPa?" },
    words: { en: ["troposphere", "altitude"], es: ["troposfera", "altitud"] }, phrases: { en: ["upper air temperature"], es: ["temperatura en altura"] } }),
  topic({ id: "geopotential-height", collections: ["M2TMNXSLV"], variables: ["merra2.H500"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "500 hPa height (ridges and troughs)", es: "Altura de 500 hPa (crestas y vaguadas)" },
    question: { en: "Is the 500 hPa surface rising over this region, consistent with a warmer column?", es: "¿Se eleva la superficie de 500 hPa en la región, coherente con una columna más cálida?" },
    words: { en: ["geopotential"], es: ["geopotencial"] }, phrases: { en: ["geopotential height"], es: ["altura geopotencial"] } }),
  topic({ id: "near-surface-wind", collections: ["M2TMNXSLV"], variables: ["merra2.U10M", "merra2.V10M"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Near-surface wind components", es: "Componentes del viento en superficie" },
    question: { en: "Have the prevailing eastward or northward winds strengthened or weakened?", es: "¿Se han fortalecido o debilitado los vientos dominantes hacia el este o el norte?" },
    words: { en: ["wind"], es: ["viento"] }, phrases: { en: ["surface wind"], es: ["viento en superficie"] } }),
  topic({ id: "water-vapor", collections: ["M2TMNXSLV"], variables: ["merra2.TQV"], extraAnalyses: CLIMATE, suggestedPeriod: FULL_PERIOD,
    title: { en: "Atmospheric water vapor", es: "Vapor de agua atmosférico" },
    question: { en: "Is the atmosphere over this region getting moister?", es: "¿Se está volviendo más húmeda la atmósfera sobre esta región?" },
    words: { en: ["vapor"], es: ["vapor"] }, phrases: { en: ["precipitable water"], es: ["agua precipitable"] } }),
  topic({ id: "cloud-water", collections: ["M2TMNXSLV"], variables: ["merra2.TQL", "merra2.TQI"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Cloud liquid and ice water", es: "Agua líquida y hielo en nubes" },
    question: { en: "Are clouds holding more liquid water or ice than in the past?", es: "¿Contienen las nubes más agua líquida o hielo que en el pasado?" },
    words: { en: ["cloud"], es: ["nubes"] }, phrases: { en: ["cloud water"], es: ["agua en nubes"] } }),
  topic({ id: "ozone", collections: ["M2TMNXSLV"], variables: ["merra2.TO3"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Total column ozone", es: "Ozono total en columna" },
    question: { en: "Is total ozone recovering or declining over this region?", es: "¿Se recupera o disminuye el ozono total sobre esta región?" },
    words: { en: ["ozone"], es: ["ozono"] }, phrases: { en: ["ozone layer"], es: ["capa de ozono"] } }),
  topic({ id: "tropopause", collections: ["M2TMNXSLV"], variables: ["merra2.TROPT", "merra2.TROPPB"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Tropopause temperature and height", es: "Temperatura y altura de la tropopausa" },
    question: { en: "Is the tropopause getting higher (lower pressure) as the troposphere warms?", es: "¿Se eleva la tropopausa (menor presión) a medida que se calienta la troposfera?" },
    words: { en: ["tropopause"], es: ["tropopausa"] }, phrases: { en: ["tropopause height"], es: ["altura de la tropopausa"] } }),
  topic({ id: "precipitation", collections: ["M2TMNXFLX"], variables: ["merra2.PRECTOTCORR"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Precipitation", es: "Precipitación" },
    question: { en: "Is it raining more or less than before, and in which season?", es: "¿Llueve más o menos que antes y en qué temporada?" },
    words: { en: ["rain", "precipitation"], es: ["lluvia", "precipitacion"] }, phrases: { en: ["rainfall trend"], es: ["tendencia de lluvias"] } }),
  topic({ id: "snowfall", collections: ["M2TMNXFLX"], variables: ["merra2.PRECSNO"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Snowfall", es: "Nevadas" },
    question: { en: "Is snowfall declining in this region?", es: "¿Disminuyen las nevadas en esta región?" },
    words: { en: ["snowfall"], es: ["nevadas"] }, phrases: { en: ["snowfall trend"], es: ["tendencia de nevadas"] } }),
  topic({ id: "evaporation", collections: ["M2TMNXFLX"], variables: ["merra2.EVAP"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Evaporation", es: "Evaporación" },
    question: { en: "Is surface evaporation increasing as temperatures rise?", es: "¿Aumenta la evaporación superficial al subir la temperatura?" },
    words: { en: ["evaporation"], es: ["evaporacion"] }, phrases: { en: ["water loss"], es: ["perdida de agua"] } }),
  topic({ id: "surface-energy", collections: ["M2TMNXFLX"], variables: ["merra2.HFLUX", "merra2.EFLUX"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Surface energy fluxes", es: "Flujos de energía en superficie" },
    question: { en: "Is the surface sending more energy upward as sensible or latent heat?", es: "¿Emite la superficie más energía hacia arriba como calor sensible o latente?" },
    words: { en: ["energy", "flux"], es: ["energia", "flujo"] }, phrases: { en: ["heat flux"], es: ["flujo de calor"] } }),
  topic({ id: "boundary-layer", collections: ["M2TMNXFLX"], variables: ["merra2.PBLH"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Boundary layer depth", es: "Espesor de la capa límite" },
    question: { en: "Is the daytime mixing layer getting deeper, affecting air quality?", es: "¿Se hace más profunda la capa de mezcla, afectando la calidad del aire?" },
    words: { en: ["boundary"], es: ["capa"] }, phrases: { en: ["boundary layer"], es: ["capa limite"] } }),
  topic({ id: "soil-moisture", collections: ["M2TMNXLND"], variables: ["merra2.GWETTOP", "merra2.GWETROOT"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Soil moisture and drought", es: "Humedad del suelo y sequía" },
    question: { en: "Are soils drying out at the surface and in the root zone?", es: "¿Se están secando los suelos en superficie y en la zona radicular?" },
    words: { en: ["drought", "soil"], es: ["sequia", "suelo"] }, phrases: { en: ["soil moisture"], es: ["humedad del suelo"] } }),
  topic({ id: "snow-cover", collections: ["M2TMNXLND"], variables: ["merra2.SNOMAS", "merra2.FRSNO"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Snowpack and snow cover", es: "Manto y cobertura de nieve" },
    question: { en: "Is the snowpack shrinking, and is snow covering less land?", es: "¿Se reduce el manto de nieve y cubre menos tierra?" },
    words: { en: ["snowpack"], es: ["nieve"] }, phrases: { en: ["snow cover"], es: ["cobertura de nieve"] } }),
  topic({ id: "runoff", collections: ["M2TMNXLND"], variables: ["merra2.RUNOFF"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Surface runoff", es: "Escorrentía superficial" },
    question: { en: "Is more water running off the land surface than before?", es: "¿Escurre más agua sobre la superficie terrestre que antes?" },
    words: { en: ["runoff", "flood"], es: ["escorrentia", "inundacion"] }, phrases: { en: ["surface runoff"], es: ["escorrentia superficial"] } }),
  topic({ id: "radiation-clouds", collections: ["M2TMNXRAD"], variables: ["merra2.SWGDN", "merra2.CLDTOT"], extraAnalyses: HYDRO, suggestedPeriod: FULL_PERIOD,
    title: { en: "Sunlight and cloud cover", es: "Luz solar y nubosidad" },
    question: { en: "Is more sunlight reaching the surface as cloud cover changes?", es: "¿Llega más luz solar a la superficie al cambiar la nubosidad?" },
    words: { en: ["sunlight", "clouds"], es: ["sol", "nubes"] }, phrases: { en: ["solar radiation"], es: ["radiacion solar"] } }),
  topic({ id: "aerosols", collections: ["M2TMNXAER"], variables: ["merra2.TOTEXTTAU", "merra2.DUEXTTAU"], extraAnalyses: HYDRO, suggestedPeriod: RECENT_PERIOD,
    title: { en: "Aerosols and dust", es: "Aerosoles y polvo" },
    question: { en: "Is the air getting hazier, and how much of the change is dust?", es: "¿Se vuelve el aire más turbio y cuánto del cambio se debe al polvo?" },
    words: { en: ["aerosol", "dust"], es: ["aerosoles", "polvo"] }, phrases: { en: ["air pollution"], es: ["contaminacion del aire"] } }),
];
