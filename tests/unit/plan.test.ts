import { describe, expect, it } from "vitest";
import { regionByNumeric } from "@/src/catalog/regions";
import { EXAMPLE, FOLLOW_UPS, samplePlaces } from "@/src/plan/examples";
import { MAX_VARIABLES } from "@/src/jobs/selection";
import { addVariable, buildPlan, keepDerived, lastCompleteYear, looksLikeQuestion, MIN_TREND_YEARS, periodYearRange, type PlanDraft, suggestedPeriod, suggestQuestion, topicFor, workingTitle } from "@/src/plan/plan";
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

  it("explains every reason Start analysis is disabled (a missing question is not one)", () => {
    const plan = buildPlan(draft({ question: " ", variables: [], location: { mode: "country", regionId: null, customBBox: null } }));
    expect(plan.ready).toBe(false);
    expect(plan.blockers).toEqual([expect.stringMatching(/at least one variable/), expect.stringMatching(/country or territory/)]);
    expect(plan.blockers.some((b) => /question/i.test(b))).toBe(false);
    expect(buildPlan(draft({ start: "2024-12", end: "2005-01" })).blockers).toContain("The end month must not be before the start month.");
    expect(buildPlan(draft({ start: "2024-01", end: "2024-06" })).blockers).toContain("Choose at least 12 months.");
    expect(buildPlan(draft({ location: { mode: "custom", regionId: "country:CO", customBBox: null } })).blockers).toContain("Draw or type the custom area.");
  });

  it("uses an editable working title as the question in manual mode", () => {
    const plan = buildPlan(draft({ question: "", start: "2000-01", end: "2020-12" }));
    expect(plan.ready).toBe(true);
    expect(plan.blockers).toEqual([]);
    expect(plan.questionIsWorkingTitle).toBe(true);
    expect(plan.question).toBe("Trend in near-surface air temperature (2 m), Colombia, 2000–2020");
    expect(plan.selection?.question).toBe(plan.question);
    // A typed question replaces it; the working title never triggers the year-mismatch warning.
    expect(buildPlan(draft({ question: "Is Colombia warming?" }))).toMatchObject({ question: "Is Colombia warming?", questionIsWorkingTitle: false });
    expect(plan.checks.some((c) => c.text.includes("outside the selected period"))).toBe(false);
    expect(workingTitle({ variables: ["merra2.T2M", "merra2.PRECTOTCORR"], start: "2010-01", end: "2010-12", location: { mode: "custom", regionId: null, customBBox: { west: -80, south: -5, east: -66, north: 13 } } })).toMatch(
      /^Trend in near-surface air temperature \(2 m\) and .+, custom area, 2010$/,
    );
    expect(workingTitle({ variables: ["merra2.T2M", "merra2.TS", "merra2.QV2M"], start: "2010-01", end: "2019-12", location: colombia })).toContain("and 2 more variables, Colombia, 2010–2019");
  });

  it("warns when the period is too short for the trend and the period comparison", () => {
    const plan = buildPlan(draft({ start: "2020-01", end: "2024-12" }));
    expect(plan.ready).toBe(true);
    expect(plan.checks.filter((c) => c.level === "warn").map((c) => c.text)).toEqual(
      expect.arrayContaining([expect.stringContaining(`Fewer than ${MIN_TREND_YEARS} complete years (5): the trend will be uncertain`), expect.stringContaining("Period comparison needs at least 6")]),
    );
  });

  it("flags a period outside the archive without rewriting it", () => {
    // SeaWiFS ends in 2010-12: the dates stay as chosen, a warning explains, and the schema keeps Start analysis disabled.
    const plan = buildPlan(draft({ variables: ["seawifs.chlor_a"], start: "2005-01", end: "2024-12" }));
    expect(plan.period).toMatchObject({ start: "2005-01", end: "2024-12" });
    expect(plan.checks.some((c) => c.level === "warn" && c.text.includes("after the archive coverage") && c.text.includes("Dec 2010"))).toBe(true);
    expect(plan.ready).toBe(false);
    const reversed = buildPlan(draft({ start: "2024-12", end: "2005-01" }));
    expect(reversed.period).toMatchObject({ start: "2024-12", end: "2005-01", months: 0 });
  });

  it("offers every year of the selected variables' archive, plus the years already chosen", () => {
    const thisYear = new Date().getUTCFullYear();
    expect(periodYearRange([], "2006-01", "2025-12")).toEqual({ min: 1980, max: thisYear });
    expect(periodYearRange(["merra2.T2M"], "2006-01", "2025-12")).toEqual({ min: 1980, max: thisYear });
    expect(periodYearRange(["era5.t2m"], "2006-01", "2025-12").min).toBe(1940);
    expect(periodYearRange(["seawifs.chlor_a"], "2000-01", "2009-12")).toEqual({ min: 1997, max: 2010 });
    // A chosen year outside the archive stays visible in the select instead of being replaced.
    expect(periodYearRange(["seawifs.chlor_a"], "2006-01", "2025-12")).toEqual({ min: 1997, max: 2025 });
  });

  it("adds exactly the variable picked, never related ones", () => {
    expect(addVariable(["merra2.TS"], "merra2.T2M")).toEqual(["merra2.TS", "merra2.T2M"]);
    const same = ["merra2.T2M"];
    expect(addVariable(same, "merra2.T2M")).toBe(same);
    expect(addVariable(same, "not.a.variable")).toBe(same);
    const full = ["merra2.T2M", "merra2.TS", "merra2.QV2M", "merra2.T2MDEW", "merra2.PS", "merra2.SLP", "merra2.U10M", "merra2.V10M", "merra2.U2M", "merra2.V2M", "merra2.TQV", "merra2.PRECTOTCORR"];
    expect(full).toHaveLength(MAX_VARIABLES);
    expect(addVariable(full, "merra2.GWETTOP")).toBe(full);
    // Selecting both inputs of a derived series does not add it; removing an input drops it.
    expect(keepDerived(["merra2.TS", "merra2.T2M"], [])).toEqual([]);
    expect(keepDerived(["merra2.T2M"], ["derived.TS-T2M"])).toEqual([]);
    expect(keepDerived(["merra2.TS", "merra2.T2M"], ["derived.TS-T2M"])).toEqual(["derived.TS-T2M"]);
  });

  it("flags a question whose years fall outside the period", () => {
    const edited = buildPlan({ ...EXAMPLE, start: "2015-01" });
    expect(edited.checks.some((c) => c.level === "warn" && c.text.includes("mentions 2005, outside the selected period (2015–2024)"))).toBe(true);
    expect(buildPlan(EXAMPLE).checks.some((c) => c.text.includes("outside the selected period"))).toBe(false);
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

  it("leaves a generated working title out of the link, so it keeps following the selection", () => {
    const generated = buildPlan(draft({ question: "" })).selection!;
    expect(generated.question).toBe("Trend in near-surface air temperature (2 m), Colombia, 2005–2024");
    const href = setupHref(generated);
    expect(new URLSearchParams(href.slice(2)).has("q")).toBe(false);
    expect(draftFromParams(Object.fromEntries(new URLSearchParams(href.slice(2))))?.question).toBe("");
    const typed = buildPlan(draft({ question: "Is Colombia warming?" })).selection!;
    expect(new URLSearchParams(setupHref(typed).slice(2)).get("q")).toBe("Is Colombia warming?");
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
