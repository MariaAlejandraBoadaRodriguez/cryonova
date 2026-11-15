/**
 * NASA Giovanni area averages, requested through NASA Harmony
 * (giovanni-averaging-service, OGC API EDR "cube" with average=area).
 *
 * Only collections whose Harmony capabilities list the Giovanni services are
 * included (GLDAS_NOAH025_M 2.1 and GPM_3IMERGM 07, checked 2026-11-15). Giovanni
 * names each field <ShortName>_<version>_<variable>; both fields below returned
 * real values in live Harmony jobs (90c61434… and d2ea801d…, 2010, Colombia box).
 * Units are those of the source collection's DAS. Giovanni computes the area
 * average itself, so cell counts are not reported.
 */
import { GLDAS_COLLECTIONS } from "./gldas";
import { IMERG_COLLECTIONS } from "./imerg";
import type { CatalogVariable, CollectionSpec } from "./types";

function viaGiovanni(source: CollectionSpec, shortName: string): CollectionSpec {
  return {
    ...source,
    source: "giovanni",
    shortName,
    title: `${source.title} — area average computed by NASA Giovanni`,
    provider: `${source.provider}; area average by NASA Giovanni`,
    servedBy: "NASA Harmony (Giovanni)",
    access: "harmony",
    fieldCount: 1,
  };
}

export const GIOVANNI_COLLECTIONS: Record<string, CollectionSpec> = {
  GIOVANNI_GLDAS_NOAH025_M: viaGiovanni(GLDAS_COLLECTIONS.GLDAS_NOAH025_M!, "GIOVANNI_GLDAS_NOAH025_M"),
  GIOVANNI_GPM_3IMERGM: viaGiovanni(IMERG_COLLECTIONS.GPM_3IMERGM!, "GIOVANNI_GPM_3IMERGM"),
};

const VERIFIED = { method: "Live Harmony/Giovanni area-average job (2010, Colombia box)", date: "2026-11-15" };

export const GIOVANNI_VARIABLES: CatalogVariable[] = [
  {
    key: "giovanni.GLDAS_SoilMoi0_10cm",
    source: "giovanni",
    collection: "GIOVANNI_GLDAS_NOAH025_M",
    dapName: "mean_GLDAS_NOAH025_M_2_1_SoilMoi0_10cm_inst",
    requestName: "GLDAS_NOAH025_M_2_1_SoilMoi0_10cm_inst",
    name: { en: "Soil moisture 0–10 cm, area average by NASA Giovanni (GLDAS)" },
    description: {
      en: "The GLDAS 0–10 cm soil moisture, averaged over the area by NASA's Giovanni service instead of by Cryonova. Useful to cross-check the OPeNDAP-based value.",
    },
    providerLongName: "Soil moisture",
    providerUnits: "kg m-2",
    fillValue: -9999,
    display: { units: "kg/m²", scale: 1, offset: 0, trendUnits: "kg/m² per decade", group: "soil_moisture", decimals: 2 },
    domain: "land",
    frequency: "monthly",
    aggregation: "Area-averaged monthly time series computed by NASA Giovanni (giovanni-averaging-service) from GLDAS_NOAH025_M 2.1.",
    words: { en: ["giovanni", "harmony", "soil", "moisture", "gldas", "cross-check"] },
    phrases: { en: ["giovanni soil moisture", "area average by giovanni"] },
    role: "primary",
    verified: VERIFIED,
  },
  {
    key: "giovanni.IMERG_precipitation",
    source: "giovanni",
    collection: "GIOVANNI_GPM_3IMERGM",
    dapName: "mean_GPM_3IMERGM_07_precipitation",
    requestName: "GPM_3IMERGM_07_precipitation",
    name: { en: "Precipitation, area average by NASA Giovanni (GPM IMERG)" },
    description: {
      en: "GPM IMERG monthly precipitation averaged over the area by NASA's Giovanni service. Provider rate in mm/hr, shown as mm/day (×24).",
    },
    providerLongName: "Merged microwave-infrared-gauge precipitation estimate",
    providerUnits: "mm/hr",
    fillValue: -9999.900390625,
    display: { units: "mm/day", scale: 24, offset: 0, trendUnits: "mm/day per decade", group: "precip_rate", decimals: 3 },
    domain: "global",
    frequency: "monthly",
    aggregation: "Area-averaged monthly time series computed by NASA Giovanni (giovanni-averaging-service) from GPM_3IMERGM 07.",
    words: { en: ["giovanni", "harmony", "precipitation", "rain", "imerg", "cross-check"] },
    phrases: { en: ["giovanni precipitation", "area average by giovanni"] },
    role: "primary",
    verified: VERIFIED,
  },
];
