/**
 * Setup links: a selection encoded as plain query parameters, so "Back to
 * setup" (and shared links) reopen the workspace with the same choices.
 * Parsing only accepts catalog variables, gazetteer regions and valid boxes.
 */
import { getVariable } from "@/src/catalog";
import { getDerived } from "@/src/catalog/derived";
import { getRegion } from "@/src/catalog/regions";
import type { Selection } from "@/src/jobs/selection";
import { validateBBox } from "@/src/providers/grid";
import { type PlanDraft, workingTitle } from "./plan";

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

type SetupSource = Pick<Selection, "variables" | "start" | "end" | "region" | "derived"> & { question?: string | null };

export function setupHref(selection: SetupSource): string {
  const params = new URLSearchParams();
  // A generated working title is left out, so the reopened setup keeps generating it from the (possibly edited) selection.
  const knownRegion = selection.region.regionId && getRegion(selection.region.regionId) ? selection.region.regionId : null;
  const location: PlanDraft["location"] = knownRegion ? { mode: "country", regionId: knownRegion, customBBox: null } : { mode: "custom", regionId: null, customBBox: selection.region.bbox };
  const generated = workingTitle({ variables: selection.variables, start: selection.start, end: selection.end, location });
  if (selection.question && selection.question !== generated) params.set("q", selection.question.slice(0, 600));
  params.set("vars", selection.variables.join(","));
  if (selection.derived && selection.derived.length > 0) params.set("derived", selection.derived.join(","));
  params.set("start", selection.start);
  params.set("end", selection.end);
  const regionId = selection.region.regionId;
  if (regionId && getRegion(regionId)) params.set("region", regionId);
  else {
    const b = selection.region.bbox;
    params.set("bbox", [b.west, b.south, b.east, b.north].join(","));
  }
  return `/?${params.toString()}`;
}

export function draftFromParams(params: Record<string, string | string[] | undefined>): PlanDraft | null {
  const one = (key: string): string | undefined => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const variables = [...new Set((one("vars") ?? "").split(",").map((k) => k.trim()))].filter((k) => getVariable(k)).slice(0, 12);
  const start = one("start") ?? "";
  const end = one("end") ?? "";
  if (variables.length === 0 || !YM.test(start) || !YM.test(end)) return null;
  let location: PlanDraft["location"] = { mode: "country", regionId: null, customBBox: null };
  const regionId = one("region");
  if (regionId && getRegion(regionId)) location = { mode: "country", regionId, customBBox: null };
  else {
    const parts = (one("bbox") ?? "").split(",").map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      const bbox = { west: parts[0]!, south: parts[1]!, east: parts[2]!, north: parts[3]! };
      if (!validateBBox(bbox)) location = { mode: "custom", regionId: null, customBBox: bbox };
    }
  }
  const derived = [...new Set((one("derived") ?? "").split(",").map((k) => k.trim()))].filter((k) => getDerived(k)?.inputs.every((input) => variables.includes(input)));
  return { question: (one("q") ?? "").slice(0, 600), variables, derived, start, end, location };
}
