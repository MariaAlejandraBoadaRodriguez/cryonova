import { describe, expect, it } from "vitest";
import { regionByNumeric } from "@/src/catalog/regions";
import { EXAMPLE, FOLLOW_UPS, samplePlaces } from "@/src/plan/examples";
import { buildPlan, lastCompleteYear, looksLikeQuestion, MIN_TREND_YEARS, type PlanDraft, suggestedPeriod, suggestQuestion, topicFor } from "@/src/plan/plan";
import { draftFromParams, setupHref } from "@/src/plan/url";

const colombia = { mode: "country" as const, regionId: "country:CO", customBBox: null };

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return { question: "Did air temperature change in Colombia?", variables: ["merra2.T2M"], derived: [], start: "2005-01", end: "2024-12", location: colombia, ...overrides };
}

describe("investigation plan", () => {
  it("turns the example into a ready plan with a named-region selection", () => {
    const plan = buildPlan(EXAMPLE);
    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.period).toMatchObject({ months: 240, completeYears: 20 });
    expect(plan.location?.label).toBe("Colombia");
    expect(plan.selection?.region).toMatchObject({ regionId: "country:CO", name: "Colombia", source: "named" });
    expect(plan.analyses.primary).toMatch(/OLS.*Newey–West/);
    expect(plan.checks.some((c) => c.level === "ok" && /20 complete years/.test(c.text))).toBe(true);
    expect(plan.checks.some((c) => /ongoing/.test(c.text))).toBe(true);
  });

  it("explains every reason Start analysis is disabled", () => {
    const plan = buildPlan(draft({ question: " ", variables: [], location: { mode: "country", regionId: null, customBBox: null } }));
    expect(plan.ready).toBe(false);
    expect(plan.blockers).toEqual(expect.arrayContaining([expect.stringMatching(/question/), expect.stringMatching(/at least one variable/), expect.stringMatching(/country or territory/)]));
    expect(buildPlan(draft({ start: "2024-12", end: "2005-01" })).blockers).toContain("The end month must not be before the start month.");
    expect(buildPlan(draft({ start: "2024-01", end: "2024-06" })).blockers).toContain("Choose at least 12 months.");
    expect(buildPlan(draft({ location: { mode: "custom", regionId: "country:CO", customBBox: null } })).blockers).toContain("Draw or type the custom area.");
  });

  it("warns when the period is too short for the trend and the period comparison", () => {
    const plan = buildPlan(draft({ start: "2020-01", end: "2024-12" }));
    expect(plan.ready).toBe(true);
    expect(plan.checks.filter((c) => c.level === "warn").map((c) => c.text)).toEqual(
      expect.arrayContaining([expect.stringContaining(`at least ${MIN_TREND_YEARS}`), expect.stringContaining("Period comparison needs at least 6")]),
    );
  });

  it("uses the custom rectangle when that mode is active and notes the 180° crossing", () => {
    const plan = buildPlan(draft({ location: { mode: "custom", regionId: "country:CO", customBBox: { west: 170, south: -20, east: -170, north: -10 } } }));
    expect(plan.ready).toBe(true);
    expect(plan.selection?.region).toMatchObject({ source: "drawn", bbox: { west: 170, east: -170 } });
    expect(plan.selection?.region.regionId).toBeUndefined();
    expect(plan.checks.some((c) => /180° meridian/.test(c.text))).toBe(true);
  });

  it("carries derived series and counts them in the multiple-comparison correction", () => {
    const plan = buildPlan(draft({ variables: ["merra2.TS", "merra2.T2M"], derived: ["derived.TS-T2M"] }));
    expect(plan.derived).toEqual([expect.objectContaining({ key: "derived.TS-T2M", formula: "TS − T2M", units: "°C" })]);
    expect(plan.selection?.derived).toEqual(["derived.TS-T2M"]);
    expect(plan.analyses.additional.some((a) => a.includes("across 3 trends"))).toBe(true);
    // A derived series whose inputs are not all selected is dropped.
    expect(buildPlan(draft({ derived: ["derived.TS-T2M"] })).selection?.derived).toBeUndefined();
  });

  it("blocks plans above the live read limit", () => {
    const plan = buildPlan(draft({ variables: ["merra2.T2M", "merra2.PRECTOTCORR", "merra2.GWETTOP"], start: "1981-01", end: "2024-12" }));
    expect(plan.reads).toBe(528 * 3);
    expect(plan.ready).toBe(true);
    const tooMany = buildPlan(draft({ variables: ["merra2.T2M", "merra2.PRECTOTCORR", "merra2.GWETTOP", "merra2.SWGDN"], start: "1981-01", end: "2024-12" }));
    expect(tooMany.ready).toBe(false);
    expect(tooMany.blockers.some((b) => b.includes("live reads"))).toBe(true);
  });

  it("suggests the topic period and a specific question", () => {
    const last = lastCompleteYear();
    expect(suggestedPeriod(["merra2.T2M"])).toEqual({ start: `${last - 19}-01`, end: `${last}-12` });
    expect(suggestedPeriod(["merra2.PS", "merra2.SLP"])).toEqual({ start: `${last - 29}-01`, end: `${last}-12` });
    // GPM IMERG is declared until 2025-09, so its last complete year is 2024 at most.
    expect(suggestedPeriod(["imerg.precipitation"]).end <= "2024-12").toBe(true);
    expect(topicFor(["merra2.T2M"])?.id).toBe("air");
    expect(topicFor(["merra2.TS", "merra2.T2M"])?.id).toBe("surface");
    expect(suggestQuestion(EXAMPLE)).toBe("Did near-surface air temperature (2 m) in Colombia change between 2005 and 2024?");
  });

  it("tells research questions from short replies in English and Spanish", () => {
    expect(looksLikeQuestion("¿Ha cambiado la lluvia en Perú?")).toBe(true);
    expect(looksLikeQuestion("How has rainfall changed in Peru")).toBe(true);
    expect(looksLikeQuestion("Colombia")).toBe(false);
    expect(looksLikeQuestion("use rain instead")).toBe(false);
  });

  it("makes every example and follow-up a ready plan", () => {
    for (const example of [EXAMPLE, ...FOLLOW_UPS]) expect(buildPlan(example).ready, example.id).toBe(true);
    expect(FOLLOW_UPS.length).toBeGreaterThanOrEqual(3);
    expect(FOLLOW_UPS.length).toBeLessThanOrEqual(5);
    expect(samplePlaces()).toHaveLength(8);
  });
});

describe("setup links", () => {
  it("round-trips a named region, the period, variables and derived series", () => {
    const sel = buildPlan(draft({ variables: ["merra2.TS", "merra2.T2M"], derived: ["derived.TS-T2M"] })).selection!;
    const href = setupHref(sel);
    expect(href.startsWith("/?")).toBe(true);
    const params = Object.fromEntries(new URLSearchParams(href.slice(2)));
    expect(draftFromParams(params)).toEqual({ question: sel.question, variables: ["merra2.TS", "merra2.T2M"], derived: ["derived.TS-T2M"], start: "2005-01", end: "2024-12", location: colombia });
  });

  it("round-trips a custom box and drops unknown or invalid values", () => {
    const params = { vars: "merra2.T2M,not.a.var", derived: "derived.TS-T2M", start: "2010-01", end: "2019-12", bbox: "-80,-5,-66,13" };
    expect(draftFromParams(params)).toEqual({ question: "", variables: ["merra2.T2M"], derived: [], start: "2010-01", end: "2019-12", location: { mode: "custom", regionId: null, customBBox: { west: -80, south: -5, east: -66, north: 13 } } });
    expect(draftFromParams({ vars: "merra2.T2M", start: "2010-13", end: "2019-12" })).toBeNull();
    expect(draftFromParams({ vars: "merra2.T2M", start: "2010-01", end: "2019-12", bbox: "0,0,500,1" })?.location.customBBox).toBeNull();
  });
});

describe("globe country picking", () => {
  it("maps world-atlas numeric ids to gazetteer countries", () => {
    expect(regionByNumeric("170")?.id).toBe("country:CO");
    expect(regionByNumeric(76)?.id).toBe("country:BR");
    expect(regionByNumeric("999")).toBeUndefined();
  });
});
