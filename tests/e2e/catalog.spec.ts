import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import ts from "typescript";

/** WCAG 2.x A/AA checks; serious and critical findings fail the test. */
async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(" | ")}`)).toEqual([]);
}

const shot = (name: string) => `docs/benchmarks/screenshots/${name}-${test.info().project.name}.png`;

/** Connector states the page may show; the tests never depend on what the live probes return. */
const ANY_STATUS = /Checking…|Verified live|Reachable|Configured, not integrated|Pending|Error|Status unavailable|Not reported/;

/**
 * The real subscribeAddVariable (src/lib/catalog-bridge.ts), compiled for the
 * browser and run in another page, as the workspace runs it.
 */
const BRIDGE = ts
  .transpileModule(readFileSync("src/lib/catalog-bridge.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
  .outputText.replace(/^export /gm, "");

async function subscribeIn(page: Page) {
  await page.evaluate(`(() => {
    ${BRIDGE}
    window.__catalogAdds = [];
    window.__broadcast = [];
    const raw = new BroadcastChannel("cryonova-catalog");
    raw.onmessage = (event) => window.__broadcast.push(event.data.key);
    subscribeAddVariable((key) => window.__catalogAdds.push(key));
  })()`);
}

const entries = (page: Page) => page.locator('[data-testid^="catalog-entry-"]');

test("catalog: every variable by source, searchable, filterable, keyboard friendly and accessible", async ({ page }) => {
  await page.goto("/catalog");
  await expect(page.getByRole("heading", { level: 1, name: "Variable catalog" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Catalog", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Data sources" })).toBeVisible();

  // Grouped by data source and connection.
  for (const name of ["MERRA-2 SLV", "Derived from MERRA-2 SLV", "MERRA-2 FLX", "MERRA-2 LND", "MERRA-2 RAD", "MERRA-2 AER", "GPM IMERG", "GLDAS Noah", "SeaWiFS", "ERA5", "NOAA stations", "NASA Giovanni · GLDAS_NOAH025_M", "NASA Giovanni · GPM_3IMERGM"]) {
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} ·`) })).toBeVisible();
  }
  await expect(page.getByTestId("catalog-count")).toHaveText(/^\d+ entries: \d+ variables and \d+ derived series\.$/);
  const total = await entries(page).count();
  expect(total).toBeGreaterThan(90);

  // Each entry: name, code, description, units, product and version, resolution, frequency, coverage, geometry, connector status.
  const t2m = page.getByTestId("catalog-entry-merra2.T2M");
  await expect(t2m.getByRole("heading", { level: 3, name: "Near-surface air temperature (2 m)" })).toBeVisible();
  for (const text of ["T2M", "Air temperature 2 meters above the surface.", "°C", "provider units: K", "M2TMNXSLV v5.12.4", "0.5° lat × 0.625° lon", "Monthly", "Jan 1980 – present", "Grid"]) {
    await expect(t2m).toContainText(text);
  }
  await expect(t2m.locator("dd .badge")).toHaveText(ANY_STATUS);
  await expect(page.getByTestId("catalog-entry-noaa.PRCP")).toContainText("Points (weather stations)");
  await expect(page.getByTestId("catalog-inputs-derived.TS-T2M")).toContainText("Surface skin temperature");
  await expect(page.getByTestId("catalog-group-status-ERA5_SL_MONTHLY")).toContainText("Copernicus ERA5 (CDS) connector:");

  // Search narrows the results (keyboard only).
  const search = page.getByRole("searchbox", { name: "Search variables" });
  await search.focus();
  await page.keyboard.type("soil moisture");
  await expect(page.getByTestId("catalog-count")).toHaveText(/entries match of \d+/);
  await expect(page.getByTestId("catalog-group-GLDAS_NOAH025_M")).toBeVisible();
  await expect(page.getByTestId("catalog-group-GIOVANNI_GLDAS_NOAH025_M")).toBeVisible();
  await expect(page.getByTestId("catalog-group-M2TMNXSLV")).toHaveCount(0);
  const soil = await entries(page).count();
  expect(soil).toBeGreaterThan(0);
  expect(soil).toBeLessThan(total);
  for (const name of await entries(page).getByRole("heading", { level: 3 }).allTextContents()) expect(name.toLowerCase()).toContain("soil");

  // Nothing matches: an empty state with a way back.
  await search.fill("no such variable zzz");
  await expect(page.getByTestId("catalog-empty")).toContainText("Nothing in the catalog matches “no such variable zzz”");
  await expect(entries(page)).toHaveCount(0);
  await page.getByTestId("catalog-reset").press("Enter");
  await expect(entries(page)).toHaveCount(total);
  await expect(search).toHaveValue("");

  // The source filter, alone and with a search.
  const source = page.getByRole("combobox", { name: "Source" });
  await expect(source.locator("option", { hasText: "Copernicus ERA5 (CDS)" })).toHaveCount(1);
  await source.selectOption("era5");
  await expect(page.locator('section[data-testid^="catalog-group-"]')).toHaveCount(1);
  await expect(page.getByTestId("catalog-group-ERA5_SL_MONTHLY")).toBeVisible();
  await expect(page.getByTestId("catalog-group-M2TMNXSLV")).toHaveCount(0);
  await search.fill("temperature");
  await expect(page.getByTestId("catalog-count")).toHaveText(/match/);
  const era5Temperature = await entries(page).evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-testid")));
  expect(era5Temperature.length).toBeGreaterThan(0);
  expect(era5Temperature.every((id) => id?.startsWith("catalog-entry-era5."))).toBe(true);
  await search.fill("");
  await source.selectOption("");
  await expect(entries(page)).toHaveCount(total);

  // The section links move focus to a group heading.
  await page.getByTestId("catalog-jump").getByRole("link", { name: /^ERA5/ }).press("Enter");
  await expect(page.getByRole("heading", { level: 2, name: /^ERA5 ·/ })).toBeFocused();

  await expectAccessible(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByTestId("catalog-connectors")).not.toContainText("Checking", { timeout: 30_000 }).catch(() => undefined);
  await page.screenshot({ path: shot("catalog"), fullPage: false });
});

test("Add to investigation reaches a workspace tab subscribed with subscribeAddVariable", async ({ page }) => {
  const workspace = await page.context().newPage();
  await workspace.goto("/");
  await expect(workspace.getByRole("heading", { name: "Investigation setup" })).toBeVisible();
  await subscribeIn(workspace);

  await page.goto("/catalog");
  const add = page.getByTestId("catalog-add-merra2.T2M");
  await expect(add).toHaveAccessibleName("Add to investigation: Near-surface air temperature (2 m)");
  await expect(page.getByTestId("catalog-added-merra2.T2M")).toHaveText("");
  await add.click();
  await expect(page.getByTestId("catalog-added-merra2.T2M")).toHaveText("Added to your investigation");
  await expect(page.getByTestId("catalog-added-merra2.T2M")).toHaveRole("status");

  // Delivered once (BroadcastChannel and the storage fallback are deduplicated), and through both transports.
  await expect.poll(() => workspace.evaluate(() => (window as unknown as { __catalogAdds: string[] }).__catalogAdds)).toEqual(["merra2.T2M"]);
  await expect.poll(() => workspace.evaluate(() => (window as unknown as { __broadcast: string[] }).__broadcast)).toEqual(["merra2.T2M"]);
  const stored = await workspace.evaluate(() => window.localStorage.getItem("cryonova:catalog:add"));
  expect(JSON.parse(stored ?? "{}")).toMatchObject({ type: "add-variable", key: "merra2.T2M" });

  // A derived series lists its inputs; "Add inputs" posts each one (with the keyboard).
  await expect(page.getByTestId("catalog-inputs-derived.TS-T2M")).toContainText("TS");
  const addInputs = page.getByTestId("catalog-add-inputs-derived.TS-T2M");
  await expect(addInputs).toHaveAccessibleName("Add inputs: TS and T2M, for Surface minus 2 m air temperature");
  await addInputs.press("Enter");
  await expect(page.getByTestId("catalog-added-derived.TS-T2M")).toHaveText("Added TS and T2M to your investigation");
  await expect(page.getByTestId("catalog-added-merra2.TS")).toHaveText("Added to your investigation");
  await expect(page.getByTestId("catalog-added-merra2.T2M")).toHaveText("Added to your investigation again");
  await expect.poll(() => workspace.evaluate(() => (window as unknown as { __catalogAdds: string[] }).__catalogAdds)).toEqual(["merra2.T2M", "merra2.TS", "merra2.T2M"]);

  // Feedback survives filtering.
  await page.getByRole("searchbox", { name: "Search variables" }).fill("skin temperature");
  await expect(page.getByTestId("catalog-added-merra2.TS")).toHaveText("Added to your investigation");
  await expectAccessible(page);
  await workspace.close();
});

test("end to end: Browse all variables opens the catalog, and Add to investigation puts the variable in the workspace setup", async ({ page }) => {
  await page.goto("/");
  // The workspace subscribes once hydrated; the globe texture loads after that.
  await expect(page.getByTestId("globe")).toHaveAttribute("data-texture", "loaded", { timeout: 20_000 });
  const tags = page.locator('[data-testid^="variable-tag-"]');
  await expect(page.getByTestId("variable-tag-merra2.T2M")).toHaveCount(0);

  const [catalog] = await Promise.all([page.context().waitForEvent("page"), page.getByTestId("browse-catalog").click()]);
  await catalog.waitForLoadState();
  await expect(catalog).toHaveURL(/\/catalog$/);
  await expect(catalog.getByRole("heading", { level: 1, name: "Variable catalog" })).toBeVisible();

  await catalog.getByTestId("catalog-add-merra2.T2M").click();
  await expect(catalog.getByTestId("catalog-added-merra2.T2M")).toHaveText("Added to your investigation");
  await expect(page.getByTestId("variable-tag-merra2.T2M")).toBeVisible();
  await expect(tags).toHaveCount(1);

  // A derived series' inputs: TS is added, T2M is already there and is not duplicated.
  await catalog.getByTestId("catalog-add-inputs-derived.TS-T2M").click();
  await expect(page.getByTestId("variable-tag-merra2.TS")).toBeVisible();
  await expect(tags).toHaveCount(2);
  await catalog.close();
});
