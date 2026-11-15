/**
 * The guide's example investigation and its follow-up questions. Clicking one
 * pre-fills the setup; nothing here is a live result. The optional preview is
 * a saved run, labeled with its fetch date.
 */
import { type BBox, getRegion } from "@/src/catalog/regions";
import type { PlanDraft } from "./plan";

export interface ExampleInvestigation extends PlanDraft {
  id: string;
  title: string;
  why: string;
}

const colombia = { mode: "country" as const, regionId: "country:CO", customBBox: null };

export const EXAMPLE: ExampleInvestigation & { savedPreview: { runId: string; fetched: string; headline: string; detail: string } } = {
  id: "example-colombia-t2m",
  title: "Example investigation",
  why: "One variable, one country, 20 complete years: enough for a trend with uncertainty.",
  question: "Did near-surface air temperature in Colombia change between 2005 and 2024?",
  variables: ["merra2.T2M"],
  derived: [],
  start: "2005-01",
  end: "2024-12",
  location: colombia,
  savedPreview: {
    runId: "d82edcbd-17fb-41e7-b048-df0062b128a9",
    fetched: "2026-11-14 21:02–21:03 UTC",
    headline: "+0.33 °C per decade (95% CI +0.04 to +0.62)",
    detail: "MERRA-2 M2TMNXSLV v5.12.4, 240 of 240 months, p = 0.024",
  },
};

export const FOLLOW_UPS: ExampleInvestigation[] = [
  {
    id: "follow-seasons",
    title: "Seasonal trends",
    why: "Same place and dates; compares DJF, MAM, JJA and SON trends.",
    question: "Did some seasons warm faster than others in Colombia between 2005 and 2024?",
    variables: ["merra2.T2M"],
    derived: [],
    start: "2005-01",
    end: "2024-12",
    location: colombia,
  },
  {
    id: "follow-anomalies",
    title: "Monthly anomalies",
    why: "How unusual recent months were against each month's 2005–2024 mean.",
    question: "How unusual were the 2023–2024 months in Colombia compared with the same months since 2005?",
    variables: ["merra2.T2M"],
    derived: [],
    start: "2005-01",
    end: "2024-12",
    location: colombia,
  },
  {
    id: "follow-precipitation",
    title: "Precipitation, two sources",
    why: "Reanalysis vs satellite estimate over the same area.",
    question: "Did precipitation over Colombia change between 2005 and 2024 according to MERRA-2 and GPM IMERG?",
    variables: ["merra2.PRECTOTCORR", "imerg.precipitation"],
    derived: [],
    start: "2005-01",
    end: "2024-12",
    location: colombia,
  },
  {
    id: "follow-periods",
    title: "Compare two decades",
    why: "Mean of 2015–2024 against 2005–2014, with a Welch test.",
    question: "Was 2015–2024 warmer than 2005–2014 in Colombia?",
    variables: ["merra2.T2M"],
    derived: [],
    start: "2005-01",
    end: "2024-12",
    location: colombia,
  },
  {
    id: "follow-humidity",
    title: "Humid heat",
    why: "Related variables: near-surface humidity and dew point.",
    question: "Did near-surface humidity and dew point change in Colombia between 2005 and 2024?",
    variables: ["merra2.QV2M", "merra2.T2MDEW"],
    derived: [],
    start: "2005-01",
    end: "2024-12",
    location: colombia,
  },
];

/** Sample locations shown as blue markers on the globe; clicking one selects it. */
const SAMPLE_REGION_IDS = ["country:CO", "region:amazon", "region:sahel", "region:tibetan-plateau", "region:mediterranean", "country:GL", "country:IN", "country:AU"];

export interface SamplePlace {
  id: string;
  label: string;
  lon: number;
  lat: number;
}

/** Center of a box, handling boxes that cross the 180° meridian. */
export function bboxCenter(bbox: BBox): { lon: number; lat: number } {
  const east = bbox.east < bbox.west ? bbox.east + 360 : bbox.east;
  let lon = (bbox.west + east) / 2;
  if (lon > 180) lon -= 360;
  return { lon, lat: (bbox.south + bbox.north) / 2 };
}

export function samplePlaces(): SamplePlace[] {
  return SAMPLE_REGION_IDS.map((id) => getRegion(id))
    .filter((r) => r !== undefined)
    .map((r) => ({ id: r.id, label: r.names.en, ...bboxCenter(r.bbox) }));
}
