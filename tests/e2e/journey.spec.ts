import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Map tiles are decorative and may be blocked in CI sandboxes.
test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
});

test("landing offers a question box and a new investigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Ask the Earth a question/ })).toBeVisible();
  await expect(page.getByLabel("Your question (English or Spanish)")).toBeVisible();
  await expect(page.getByRole("link", { name: "New investigation" }).first()).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => v.id)).toEqual([]);
});

test("workspace is accessible and starts with no selection", async ({ page }) => {
  await page.goto("/investigate");
  await expect(page.getByTestId("map")).toBeVisible();
  await expect(page.getByText("No region selected yet.")).toBeVisible();
  await expect(page.getByTestId("run-button")).toBeDisabled();
  await page.screenshot({ path: `docs/benchmarks/screenshots/workspace-${test.info().project.name}.png`, fullPage: false });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude(".leaflet-container").analyze();
  expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
});

test("manual journey: region by name, period, variable, live run, chart and provenance", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" || !process.env.LIVE_E2E, "Live provider journey: set LIVE_E2E=1 (desktop only).");
  test.setTimeout(240_000);
  await page.goto("/investigate");
  await page.getByLabel("Region by name").fill("Colombia");
  await page.getByRole("option", { name: /^Colombia/ }).click();
  await expect(page.getByText(/Selected: Colombia/)).toBeVisible();

  await page.getByLabel("Start year").selectOption("2012");
  await page.getByLabel("Start month").selectOption("01");
  await page.getByLabel("End year").selectOption("2023");
  await page.getByLabel("End month").selectOption("12");

  await page.getByLabel("Search the catalog").fill("air temperature");
  await page.getByRole("button", { name: "Add Near-surface air temperature (2 m)" }).click();
  await expect(page.getByRole("button", { name: "Remove Near-surface air temperature (2 m)" }).first()).toBeVisible();

  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("run-progress")).toBeVisible();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 200_000 });
  await expect(page.getByTestId("trend-value")).toContainText("°C/decade");
  await expect(page.locator('[data-testid="series-chart"] .main-svg').first()).toBeVisible();
  await expect(page.getByTestId("provenance")).toContainText("M2TMNXSLV");
  await expect(page.getByTestId("provenance")).toContainText("144 of 144 months read");
  await page.screenshot({ path: "docs/benchmarks/screenshots/t3-results-desktop.png", fullPage: true });
});

test("keyboard users can pick a region and reach the run button", async ({ page }) => {
  await page.goto("/investigate");
  const input = page.getByLabel("Region by name");
  await input.focus();
  await page.keyboard.type("Brasil");
  await expect(page.getByRole("option", { name: /^Brazil/ })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/Selected: Brazil/)).toBeVisible();
  await page.getByLabel("North").fill("5");
  await page.getByRole("button", { name: "Apply coordinates" }).press("Enter");
  await expect(page.getByText(/Selected: Custom box/)).toBeVisible();
});

test("guided journey: question from the landing page becomes an editable proposal, a live run and a verified explanation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop" || !process.env.LIVE_E2E, "Live provider journey: set LIVE_E2E=1 (desktop only).");
  test.setTimeout(240_000);
  await page.goto("/");
  await page.getByLabel("Your question (English or Spanish)").fill("Did near-surface air temperature in Colombia change between 2012 and 2023?");
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page.getByTestId("proposal")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("proposal")).toContainText(/Ready to run|Lista para ejecutar/);
  await expect(page.getByText(/Selected: Colombia/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Near-surface air temperature (2 m)" }).first()).toBeVisible();
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("results")).toBeVisible({ timeout: 200_000 });
  const explanation = page.getByTestId("explanation");
  await expect(explanation).toContainText(/What the chart shows/, { timeout: 90_000 });
  await expect(explanation).toContainText(/figures checked against the computed results/);
  await explanation.getByRole("button", { name: "Español" }).click();
  await expect(explanation).toContainText(/Qué muestra el gráfico/, { timeout: 90_000 });
  await page.screenshot({ path: "docs/benchmarks/screenshots/t6-guided-desktop.png", fullPage: true });
});
