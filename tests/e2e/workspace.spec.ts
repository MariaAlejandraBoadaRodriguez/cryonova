import { readFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/** WCAG 2.x A/AA checks; serious and critical findings fail the test. */
async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}

const shot = (name: string) => `docs/benchmarks/screenshots/${name}-${test.info().project.name}.png`;

test("initial workspace: guide with an example and follow-ups, accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Investigation setup" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Earth Trend Detective" })).toBeVisible();
  await expect(page.getByTestId("example-card")).toContainText("Did near-surface air temperature in Colombia change between 2005 and 2024?");
  await expect(page.getByTestId("example-card")).toContainText(/Saved run, fetched 2026-11-14/);
  await expect(page.locator('[data-testid^="follow-up-"]')).toHaveCount(5);
  await expect(page.getByTestId("plan")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open with code" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Data sources" })).toBeVisible();
  await expect(page.getByTestId("globe")).toHaveAttribute("data-texture", "loaded", { timeout: 20_000 });
  await expectAccessible(page);
  await page.screenshot({ path: shot("workspace-initial"), fullPage: false });
});

test("the workspace makes no requests outside its own origin (no CDN)", async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).host;
  const foreign: string[] = [];
  page.on("request", (r) => {
    const host = new URL(r.url()).host;
    if (host && host !== origin) foreign.push(host);
  });
  await page.goto("/");
  await expect(page.getByTestId("globe")).toHaveAttribute("data-texture", "loaded", { timeout: 20_000 });
  await page.getByTestId("use-example").click();
  await expect(page.getByTestId("plan")).toBeVisible();
  expect(foreign).toEqual([]);
});

test("example pre-fills the setup; edits update the plan; Start analysis explains why it is disabled", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("use-example").click();
  const plan = page.getByTestId("plan");
  await expect(plan).toBeVisible();
  await expect(page.getByTestId("plan-question")).toHaveValue("Did near-surface air temperature in Colombia change between 2005 and 2024?");
  await expect(page.getByTestId("plan-location")).toContainText("Colombia");
  await expect(page.getByTestId("plan-period")).toContainText("240 months · 20 complete years");
  await expect(page.getByTestId("plan-variables")).toContainText("Near-surface air temperature (2 m)");
  await expect(page.getByRole("button", { name: "Remove Near-surface air temperature (2 m)" })).toBeVisible();
  await expect(page.getByTestId("start-analysis")).toBeEnabled();
  await expect(page.getByText("Selected: Colombia", { exact: false })).toBeVisible();

  // Edit the period: the plan follows, and a short period is flagged.
  await page.getByLabel("Start year").selectOption("2015");
  await expect(page.getByTestId("plan-period")).toContainText("120 months · 10 complete years");
  await page.getByLabel("Start year").selectOption("2021");
  await expect(page.getByTestId("plan-checks")).toContainText("Fewer than 10 complete years (4): the trend will be uncertain");
  await expect(page.getByTestId("setup")).toContainText("Fewer than 10 complete years");
  await expect(page.getByTestId("setup")).toContainText("Period comparison needs at least 6 complete years.");

  // An impossible period keeps the plan visible and disables Start analysis with the reason; the input is not rewritten.
  await page.getByLabel("End year").selectOption("2019");
  await expect(page.getByTestId("plan-blockers")).toContainText("The end month must not be before the start month.");
  await expect(page.getByTestId("setup")).toContainText("The end month must not be before the start month.");
  await expect(page.getByLabel("Start year")).toHaveValue("2021");
  await expect(page.getByLabel("End year")).toHaveValue("2019");
  const start = page.getByTestId("start-analysis");
  await expect(start).toBeDisabled();
  await expect(start).toHaveAttribute("aria-describedby", /.+/);

  // Back to a valid edit, with an extra variable from the search suggestions (the catalog checkbox list is gone).
  await page.getByRole("button", { name: /Use suggested \d+ years/ }).click();
  await page.getByTestId("variable-search").fill("dew point");
  await page.getByTestId("variable-option-merra2.T2MDEW").click();
  await expect(page.getByTestId("variable-tag-merra2.T2MDEW")).toBeVisible();
  await expect(page.getByTestId("plan-variables")).toContainText("Dew point temperature (2 m)");
  await expect(start).toBeEnabled();
  await expectAccessible(page);
});

test("variables: choosing one adds exactly that one; search by mouse or keyboard; every tag is removable", async ({ page }) => {
  await page.goto("/");
  const tags = page.locator('[data-testid^="variable-tag-"]');
  const search = page.getByTestId("variable-search");
  await expect(page.getByRole("checkbox", { name: /temperature/i })).toHaveCount(0);

  // Mouse: "wind" suggests wind variables; picking the eastward component adds only it (no northward pair, no derived speed).
  await search.fill("wind");
  await expect(page.getByRole("listbox", { name: "Matching variables" })).toBeVisible();
  await expect(search).toHaveAttribute("aria-expanded", "true");
  await page.getByTestId("variable-option-merra2.U10M").click();
  await expect(page.getByTestId("variable-tag-merra2.U10M")).toBeVisible();
  await expect(tags).toHaveCount(1);
  await expect(page.locator('[data-testid^="derived-tag-"]')).toHaveCount(0);
  await expect(search).toHaveValue("");

  // Keyboard: type, ArrowDown to the first suggestion, Enter adds exactly one more.
  await search.fill("rain");
  await search.press("ArrowDown");
  await expect(search).toHaveAttribute("aria-activedescendant", /.+/);
  await search.press("Enter");
  await expect(tags).toHaveCount(2);
  const suggestions = page.getByRole("listbox", { name: "Matching variables" });
  await search.fill("temperature");
  await expect(suggestions.getByRole("option").first()).toBeVisible();
  await search.press("Escape");
  await expect(suggestions).toBeHidden();
  await search.press("Escape");
  await expect(search).toHaveValue("");

  // Tags are removable one by one.
  await page.getByRole("button", { name: "Remove Eastward wind at 10 m" }).click();
  await expect(page.getByTestId("variable-tag-merra2.U10M")).toHaveCount(0);
  await expect(tags).toHaveCount(1);

  // A case fills several variables only because it was picked, and each one stays removable.
  await page.getByLabel("Investigation case").selectOption("surface");
  await expect(page.getByTestId("variable-tag-merra2.TS")).toBeVisible();
  await expect(page.getByTestId("variable-tag-merra2.T2M")).toBeVisible();
  await expect(page.getByTestId("derived-tag-derived.TS-T2M")).toBeVisible();
  await page.getByTestId("variable-tag-merra2.TS").getByRole("button").click();
  await expect(page.getByTestId("variable-tag-merra2.TS")).toHaveCount(0);
  await expect(page.getByTestId("derived-tag-derived.TS-T2M")).toHaveCount(0);
  await expect(tags).toHaveCount(1);

  // The full catalog opens in a new tab.
  const browse = page.getByTestId("browse-catalog");
  await expect(browse).toHaveAttribute("href", "/catalog");
  await expect(browse).toHaveAttribute("target", "_blank");
  await expectAccessible(page);
});

test("period: years stay editable after the suggestion, after changing variables and after picking a case", async ({ page }) => {
  await page.goto("/");
  const startYear = page.getByLabel("Start year");
  const endYear = page.getByLabel("End year");
  const thisYear = String(new Date().getUTCFullYear());
  await expect(startYear.locator("option", { hasText: "1980" })).toHaveCount(1);
  await expect(endYear.locator("option", { hasText: thisYear })).toHaveCount(1);

  await page.getByTestId("variable-search").fill("temperature");
  await page.getByTestId("variable-option-merra2.T2M").click();
  await page.getByTestId("suggested-period").click();
  const last = String(new Date().getUTCFullYear() - 1);
  await expect(endYear).toHaveValue(last);

  // After the suggestion, both years still change freely, by select and by keyboard.
  await startYear.selectOption("2001");
  await endYear.selectOption("2018");
  await expect(startYear).toHaveValue("2001");
  await expect(endYear).toHaveValue("2018");
  await startYear.focus();
  await page.keyboard.press("ArrowDown");
  await expect(startYear).toHaveValue("2000");

  // Adding a variable and picking a case never overwrite the dates the user set.
  await page.getByTestId("variable-search").fill("rain");
  await page.getByTestId("variable-option-merra2.PRECTOTCORR").click();
  await expect(page.getByTestId("variable-tag-merra2.PRECTOTCORR")).toBeVisible();
  await expect(startYear).toHaveValue("2000");
  await expect(endYear).toHaveValue("2018");
  await page.getByLabel("Investigation case").selectOption("air");
  await expect(startYear).toHaveValue("2000");
  await expect(endYear).toHaveValue("2018");
  await startYear.selectOption("1995");
  await expect(startYear).toHaveValue("1995");

  // A short period only warns; nothing is rewritten.
  await startYear.selectOption("2014");
  await expect(page.getByTestId("setup")).toContainText("Fewer than 10 complete years (5): the trend will be uncertain");
  await expect(startYear).toHaveValue("2014");
});

test("period: the year range follows the archive of the selected variables (ERA5 from 1940)", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("variable-search").fill("era5 temperature");
  await page.getByTestId("variable-option-era5.t2m").click();
  const startYear = page.getByLabel("Start year");
  await expect(startYear.locator("option", { hasText: "1940" })).toHaveCount(1);
  await startYear.selectOption("1950");
  await expect(startYear).toHaveValue("1950");
});

test("manual path: variables, period and location → Review summary → Start analysis enabled without a question", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("review-summary")).toHaveCount(0);
  await page.getByTestId("variable-search").fill("temperature");
  await page.getByTestId("variable-option-merra2.T2M").click();
  await page.getByLabel("Start year").selectOption("2000");
  await page.getByLabel("End year").selectOption("2020");
  await expect(page.getByTestId("review-summary")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Country or territory" }).selectOption({ label: "Colombia" });

  // The checklist on the right is in sync: every required item done, the question marked optional; no plan until asked.
  const progress = page.getByTestId("guide-progress");
  await expect(progress).toContainText("Optional: Question");
  await expect(progress).toContainText("Done: Variables");
  await expect(progress).toContainText("Done: Period");
  await expect(progress).toContainText("Done: Location");
  await expect(page.getByTestId("plan")).toHaveCount(0);

  await page.getByTestId("review-summary").click();
  const plan = page.getByTestId("plan");
  await expect(plan).toBeVisible();
  await expect(plan).toBeFocused();
  await expect(page.getByTestId("plan-question")).toHaveValue("Trend in near-surface air temperature (2 m), Colombia, 2000–2020");
  await expect(page.getByTestId("plan-period")).toContainText("Jan 2000 → Dec 2020");
  await expect(page.getByTestId("plan-location")).toContainText("Colombia");
  await expect(page.getByTestId("plan-variables")).toContainText("Near-surface air temperature (2 m)");
  await expect(plan).toContainText("Annual trend: OLS on complete-year means");
  await expect(page.getByTestId("plan-blockers")).toHaveCount(0);
  await expect(page.getByTestId("start-analysis")).toBeEnabled();
  await expectAccessible(page);
  await page.screenshot({ path: test.info().outputPath(`manual-summary-${test.info().project.name}.png`), fullPage: false });

  // The working title is editable, and the summary stays ready.
  await page.getByTestId("plan-question").fill("Did Colombia warm between 2000 and 2020?");
  await expect(page.getByTestId("plan-question")).toHaveValue("Did Colombia warm between 2000 and 2020?");
  await expect(page.getByTestId("start-analysis")).toBeEnabled();
});

test("catalog bridge: a variable posted from another tab is added once; unknown keys and duplicates are ignored", async ({ page }) => {
  await page.goto("/");
  const catalogTab = await page.context().newPage();
  await catalogTab.goto("/open");
  // The same message format as postAddVariable in src/lib/catalog-bridge.ts (BroadcastChannel plus the storage fallback).
  const post = (key: string) =>
    catalogTab.evaluate((k) => {
      const message = { type: "add-variable", key: k, at: Date.now() };
      const channel = new BroadcastChannel("cryonova-catalog");
      channel.postMessage(message);
      channel.close();
      window.localStorage.setItem("cryonova:catalog:add", JSON.stringify(message));
    }, key);
  const tags = page.locator('[data-testid^="variable-tag-"]');

  // Retried until the workspace has hydrated and subscribed; a repeated key is ignored, so retrying is safe.
  await expect(async () => {
    await post("merra2.T2M");
    await expect(page.getByTestId("variable-tag-merra2.T2M")).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByTestId("setup").getByRole("status").filter({ hasText: "from the catalog" })).toContainText("Added Near-surface air temperature (2 m) from the catalog.");
  await post("merra2.T2M");
  await post("not.a.variable");
  await post("imerg.precipitation");
  await expect(page.getByTestId("variable-tag-imerg.precipitation")).toBeVisible();
  await expect(tags).toHaveCount(2);
  await catalogTab.close();
  await expectAccessible(page);
});

test("ready state screenshot and plan details", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("use-example").click();
  await expect(page.getByTestId("plan")).toContainText("Annual trend: OLS on complete-year means with Newey–West HAC uncertainty");
  await expect(page.getByTestId("plan-checks")).toContainText("20 complete years");
  await expect(page.getByTestId("globe")).toHaveAttribute("data-texture", "loaded", { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("workspace-ready"), fullPage: false });
});

test("location modes: country list, custom coordinates and a sample place, all without the mouse", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Country or territory" }).selectOption({ label: "Brazil" });
  await expect(page.getByText("Selected: Brazil", { exact: false })).toBeVisible();

  await page.getByRole("radio", { name: "Custom area" }).check();
  await expect(page.getByRole("combobox", { name: "Country or territory" })).toHaveCount(0);
  await page.getByLabel("North (°)").fill("13");
  await page.getByLabel("South (°)").fill("-5");
  await page.getByLabel("West (°)").fill("-80");
  await page.getByLabel("East (°)").fill("-66");
  await page.getByRole("button", { name: "Apply coordinates" }).press("Enter");
  await expect(page.getByText("Selected: Custom area", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Select Colombia" }).press("Enter");
  await expect(page.getByText("Selected: Colombia", { exact: false })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Country or territory" })).toBeChecked();

  const globe = page.getByRole("application");
  await globe.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  await expect(globe).toBeFocused();
});

test("the assistant answers in Spanish and fills the setup as an editable proposal", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("assistant-input").fill("¿Ha cambiado la precipitación en Perú desde 2001?");
  await page.getByTestId("investigate-button").click();
  await expect(page.getByTestId("assistant-proposal")).toContainText(/Propuesta:/, { timeout: 60_000 });
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByText("Selected: Peru", { exact: false })).toBeVisible();
  await expect(page.getByTestId("plan")).toBeVisible();
  await expect(page.getByTestId("plan-period")).toContainText("Jan 2001");
  await expect(page.getByTestId("plan-question")).toHaveValue("¿Ha cambiado la precipitación en Perú desde 2001?");
});

test("old links redirect: /investigate?q= asks the assistant on the workspace", async ({ page }) => {
  await page.goto(`/investigate?q=${encodeURIComponent("Is it getting warmer in Chile since 2001?")}`);
  await expect(page).toHaveURL(/\/\?q=/);
  await expect(page.getByTestId("assistant-proposal")).toContainText(/Proposal:/, { timeout: 60_000 });
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByText("Selected: Chile", { exact: false })).toBeVisible();
});

test("a proposal never overwrites the dates in the setup unless it is applied", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("use-example").click();
  const period = page.getByTestId("plan-period");
  await expect(period).toContainText("Jan 2005");

  await page.getByTestId("assistant-input").fill("What about since 2015?");
  await page.getByTestId("assistant-input").press("Enter");
  await expect(page.getByTestId("assistant-proposal")).toContainText("Jan 2015", { timeout: 60_000 });
  // Shown, not applied: the period in the setup and the plan stays as it was.
  await expect(period).toContainText("Jan 2005");
  await expect(period).not.toContainText("Jan 2015");

  await page.getByTestId("apply-proposal").click();
  await expect(period).toContainText("Jan 2015");
  await expect(page.getByTestId("plan-location")).toContainText("Colombia");
});

test("the proposal is a readable card in the right panel; the center keeps the question and the globe", async ({ page }) => {
  await page.goto("/");
  const center = page.getByTestId("assistant");
  await expect(center.getByText(/English or Spanish|The assistant sees your setup/)).toHaveCount(0);
  await page.getByTestId("assistant-input").fill("How has temperature changed in Colombia since 2005?");
  await page.getByTestId("assistant-input").press("Enter");

  const card = page.getByTestId("guide").getByTestId("assistant-proposal");
  await expect(card).toContainText("Proposal:", { timeout: 60_000 });
  await expect(card).toContainText("Everything on the left is editable");
  await expect(card).toBeVisible();
  // Screen readers still hear it: the card sits in a polite live region.
  await expect(page.getByRole("status").filter({ has: page.getByTestId("assistant-proposal") })).toHaveAttribute("aria-live", "polite");
  expect(await card.locator(".proposal-text").evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);

  // The center only acknowledges it, with a link to the card.
  await expect(center).not.toContainText("Proposal:");
  await expect(center.getByRole("link", { name: "Review the proposal" })).toHaveAttribute("href", "#assistant-proposal");
  await expect(page.getByTestId("assistant-input")).toHaveValue("");

  // Nothing changes until the proposal is applied.
  await expect(page.getByTestId("proposal-status")).toHaveText("Nothing on the left changes until you apply it.");
  await expect(page.getByText("No location selected yet.")).toBeVisible();
  await expect(page.getByTestId("plan")).toHaveCount(0);
  await page.getByTestId("apply-proposal").click();
  await expect(page.getByTestId("proposal-status")).toHaveText("Applied to the setup and the plan.");
  await expect(page.getByText("Selected: Colombia", { exact: false })).toBeVisible();
  await expect(page.getByTestId("plan")).toBeVisible();
  await expectAccessible(page);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("workspace-proposal"), fullPage: false });
});

test("the globe keeps its instructions in its accessible description instead of a hint line", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Drag to rotate · scroll or pinch to zoom", { exact: false })).toHaveCount(0);
  const toolbar = page.getByRole("group", { name: "Map mode" });
  await expect(toolbar.locator(":scope > :not(button)")).toHaveCount(0);
  const globe = page.getByRole("application");
  await expect(globe).toHaveAccessibleName("Choose a location");
  await expect(globe).toHaveAccessibleDescription(/Drag to rotate, scroll or pinch to zoom, and click a country to select it\./);
  await expect(globe).toHaveAccessibleDescription(/Arrow keys rotate and the plus and minus keys zoom\./);
  // Drawing mode still says how to draw and cancel.
  await page.getByTestId("draw-toggle").click();
  await expect(toolbar).toContainText("Drag a rectangle on the globe. Esc cancels.");
  await page.keyboard.press("Escape");
  await expect(toolbar.locator(":scope > :not(button)")).toHaveCount(0);
});

const LONG_QUESTION =
  "How has near-surface air temperature changed in Colombia between 2005 and 2024, and is the warming stronger in the Andes during the dry season than during the wet season once the strongest ENSO years are set aside, the growth of the largest cities is considered and the gaps in satellite coverage over the mountains are taken into account?";

/** Visible text lines of a textarea (its inner height over its line height). */
function visibleLines(el: HTMLTextAreaElement): number {
  const s = getComputedStyle(el);
  return (el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight);
}

test("long questions: the question grows to four lines, Shift+Enter adds a line, Enter asks, the plan shows it all", async ({ page }) => {
  expect(LONG_QUESTION.length).toBeGreaterThanOrEqual(300);
  await page.goto("/");
  const input = page.getByTestId("assistant-input");
  await expect(input).toHaveJSProperty("tagName", "TEXTAREA");
  // Empty, it shows the placeholder: one line, or two on a narrow phone.
  const initial = await input.evaluate(visibleLines);
  expect(initial).toBeLessThan(2.5);

  // Shift+Enter inserts a line break instead of asking.
  await input.click();
  await page.keyboard.type("First line");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("second line");
  await expect(input).toHaveValue("First line\nsecond line");
  expect(Math.round(await input.evaluate(visibleLines))).toBe(2);

  // A ~300-character question grows the field to four lines; the rest scrolls inside it.
  await input.fill(LONG_QUESTION);
  expect(Math.round(await input.evaluate(visibleLines))).toBe(4);
  expect(await input.evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);

  // Enter asks; the field empties and shrinks back.
  await input.press("Enter");
  await expect(page.getByTestId("assistant-proposal")).toContainText("Proposal:", { timeout: 60_000 });
  await expect(input).toHaveValue("");
  expect(await input.evaluate(visibleLines)).toBeCloseTo(initial, 1);

  // Once applied, the plan's question shows the whole text, without an inner scrollbar.
  await page.getByTestId("apply-proposal").click();
  const planQuestion = page.getByTestId("plan-question");
  await expect(planQuestion).toHaveValue(LONG_QUESTION);
  expect(await planQuestion.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  expect(await planQuestion.evaluate(visibleLines)).toBeGreaterThan(4);
  await expectAccessible(page);
});

test("unknown runs and wrong codes are handled without revealing anything", async ({ page }) => {
  await page.goto("/investigations/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText("This run does not exist.")).toBeVisible();
  await page.goto("/open");
  await expect(page.getByRole("heading", { name: "Open with code" })).toBeVisible();
  await page.getByLabel("Retrieval code").fill("ZZZZ-ZZZZ-ZZZZ");
  await page.getByRole("button", { name: "Open investigation" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No investigation matches this code" })).toBeVisible();
  await expectAccessible(page);
});

test("live flow: example → edit → plan → Start analysis → dashboard → save → reopen by code → CSV and PDF", async ({ page, browser }) => {
  test.skip(!process.env.LIVE_E2E, "Live provider journey: set LIVE_E2E=1 (queries NASA and Neon).");
  test.setTimeout(300_000);
  await page.goto("/");
  await page.getByTestId("use-example").click();
  await page.getByLabel("Start year").selectOption("2015");
  await expect(page.getByTestId("plan-period")).toContainText("120 months");
  await page.getByTestId("start-analysis").click();

  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 240_000 });
  await expect(page.getByTestId("headline-finding")).toContainText("Near-surface air temperature (2 m) · Colombia");
  const trend = (await page.getByTestId("headline-finding").getByTestId("trend-value").textContent())?.trim() ?? "";
  expect(trend).toMatch(/°C\/decade/);
  await expect(page.locator('[data-testid="series-chart"] .main-svg').first()).toBeVisible();
  await expect(page.getByTestId("provenance")).toContainText("120 of 120 months read");
  await expect(page.getByTestId("dashboard-status")).toContainText("Live run");
  await expect(page.getByTestId("explanation")).toContainText(/figures checked against the computed results/, { timeout: 90_000 });
  await expectAccessible(page);
  await page.screenshot({ path: shot("dashboard"), fullPage: false });

  // CSV and PDF from the dashboard buttons.
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV (monthly series)" }).click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const [pdf] = await Promise.all([page.waitForEvent("download"), page.getByTestId("pdf-button").click()]);
  expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);

  await page.getByTestId("save-button").click();
  const code = (await page.getByTestId("retrieval-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  // A fresh browser context (no shared state) reopens it read-only on the same dashboard.
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto("/open");
  await page2.getByLabel("Retrieval code").fill(code.toLowerCase());
  await page2.getByRole("button", { name: "Open investigation" }).click();
  await expect(page2.getByTestId("saved-investigation")).toBeVisible();
  await expect(page2.getByTestId("dashboard-status")).toContainText("Saved investigation · read-only");
  await expect(page2.getByTestId("headline-finding").getByTestId("trend-value")).toHaveText(trend);
  expect(page2.url()).not.toContain(code);
  const results = await (await page2.request.post("/api/exports", { data: { format: "csv", code } })).text();
  expect(results).toContain("# run_id:");
  const report = await page2.request.post("/api/exports", { data: { format: "pdf", code } });
  expect(report.headers()["content-type"]).toBe("application/pdf");
  expect((await report.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await other.close();

  // Back to setup keeps the selection.
  await page.getByTestId("back-to-setup").first().click();
  await expect(page.getByTestId("plan")).toBeVisible();
  await expect(page.getByTestId("plan-period")).toContainText("Jan 2015");
  await expect(page.getByTestId("plan-location")).toContainText("Colombia");
});

/** Checks shared by the stored-result and live comparison dashboards (several variables). */
async function checkComparisonDashboard(page: Page, desktop: boolean, screenshot: string) {
  const discovery = page.getByTestId("discovery");
  await expect(discovery).toBeVisible();

  // Trend and 95% interval in one column; only the adjusted p, with the raw p as a hint; magnitude in the details.
  await expect(discovery.getByTestId("discovery-trend").first()).toHaveText(/^[+-]?\d+\.\d+ °C\/decade \([+-]?\d+\.\d+ to [+-]?\d+\.\d+\)$/);
  await expect(discovery.getByTestId("discovery-q").first()).toHaveAttribute("title", /^Raw p [=<] /);
  await expect(discovery.getByRole("columnheader")).toHaveText([/^Variable/, /^Evidence/, /^Trend per decade \(95% interval\)/, /^Adjusted p \(BH q\)/, /^Years/, /^Details/]);
  const details = discovery.getByRole("button", { name: /^Details for / }).first();
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("aria-expanded", "true");
  await expect(discovery.getByText("Change vs. variability").first()).toBeVisible();

  // Every evidence label has a "How to read this" hint that works from the keyboard.
  await expect(discovery.locator("[data-level]").first()).toContainText(/Clear trend|Possible trend, not confirmed|No clear trend yet|Not enough data/);
  const help = discovery.getByRole("button", { name: /^How to read this: / }).first();
  await help.focus();
  await page.keyboard.press("Enter");
  await expect(help).toHaveAttribute("aria-expanded", "true");
  await expect(discovery.locator(".evidence-tip").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("no-clear-trend-note")).toHaveText(/^No clear trend yet means the data cannot separate the change from natural year-to-year variation/);

  // One compact comparison chart and a caption under every chart.
  await expect(page.getByTestId("comparison-chart")).toHaveCount(1);
  await expect(page.getByTestId("comparison-chart").getByTestId("chart-caption")).toContainText("Each dot is a variable's estimated change per decade");
  await expect(page.getByTestId("headline-finding").getByTestId("series-chart").getByTestId("chart-caption")).toContainText("How to read it:");
  expect(await page.getByTestId("chart-caption").count()).toBeGreaterThanOrEqual(6);

  // Save and the three downloads on one row; the old note is gone.
  const actions = page.getByTestId("actions-row").getByRole("button");
  await expect(actions).toHaveText(["Save investigation", "Download CSV (results)", "Download CSV (monthly series)", "Download PDF report"]);
  await expect(page.getByText("Stores this exact result, method and interpretation")).toHaveCount(0);
  if (desktop) {
    const tops = await actions.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const table = await discovery.locator(".table-wrap").evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('[data-testid="comparison-chart"] .main-svg').first()).toBeVisible();
  await expectAccessible(page);
  await discovery.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot(screenshot), fullPage: false });
  await page.getByTestId("result-actions").scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot(`${screenshot}-actions`), fullPage: false });
}

test("comparison dashboard from a stored result: compact table at 1366 px, explained labels, captions, one row of actions", async ({ page }) => {
  const run = JSON.parse(readFileSync(join(__dirname, "../fixtures/dashboard-run.json"), "utf8")) as { id: string };
  await page.route(`**/api/runs/${run.id}`, (route) => route.fulfill({ json: run }));
  await page.route(`**/api/runs/${run.id}/explanation**`, (route) => route.fulfill({ status: 503, json: { error: { title: "The explanation is not available in this test." } } }));
  const desktop = test.info().project.name === "desktop";
  if (desktop) await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/investigations/${run.id}`);
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await expect(page.getByTestId("discovery-row-merra2.T2M").locator("[data-level]")).toHaveAttribute("data-level", "significant");
  await expect(page.getByTestId("discovery-row-merra2.T2MDEW")).toContainText("Possible trend, not confirmed");
  await expect(page.getByTestId("discovery-row-merra2.QV2M")).toContainText("No clear trend yet");
  await checkComparisonDashboard(page, desktop, "dashboard-comparison");
});

test("live comparison: the table fits a 1366 px laptop, labels explain themselves, charts have captions, actions share one row", async ({ page }) => {
  test.skip(!process.env.LIVE_E2E, "Live provider journey: set LIVE_E2E=1 (queries NASA).");
  test.setTimeout(300_000);
  const desktop = test.info().project.name === "desktop";
  if (desktop) await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await page.getByTestId("use-example").click();
  await page.getByLabel("Start year").selectOption("2015");
  await page.getByLabel("Browse or search the catalog").fill("dew point");
  await page.getByRole("checkbox", { name: /Dew point temperature \(2 m\)/ }).check();
  await expect(page.getByTestId("plan-variables")).toContainText("Dew point temperature (2 m)");
  await page.getByTestId("start-analysis").click();

  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 240_000 });
  await checkComparisonDashboard(page, desktop, "dashboard-comparison-live");
});
