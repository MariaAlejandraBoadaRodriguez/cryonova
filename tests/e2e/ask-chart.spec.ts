import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * "Ask about a chart" on a finished live run: every dropdown option sends its
 * chart and shows an answer. Needs live providers (NASA; Neon when the server
 * has a database), like the live journey in workspace.spec.ts.
 */
test.skip(!process.env.LIVE_E2E, "Live provider journey: set LIVE_E2E=1 (queries NASA and Neon).");

const OPTIONS = [
  { value: "series", label: "Series and trend", question: "How much did it change per decade?", automatic: /series and trend chart .*The trend is/s },
  { value: "anomalies", label: "Monthly anomalies", question: "Which month had the largest positive anomaly?", automatic: /monthly anomalies chart .*above their calendar-month mean/s },
  { value: "seasonal", label: "Seasonal cycle", question: "Which calendar month has the highest mean?", automatic: /seasonal cycle chart .*highest monthly mean is in/s },
] as const;

let runId = "";

// One short live run per worker (Colombia, 2015-2024, near-surface air temperature), started from the workspace.
test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await browser.newPage();
  await page.goto("/");
  await page.getByTestId("use-example").click();
  await page.getByLabel("Start year").selectOption("2015");
  await expect(page.getByTestId("plan-period")).toContainText("120 months");
  await page.getByTestId("start-analysis").click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  runId = new URL(page.url()).pathname.split("/").pop() ?? "";
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 240_000 });
  await page.close();
});

async function openDashboard(page: Page) {
  await page.goto(`/investigations/${runId}`);
  await expect(page.getByTestId("dashboard")).toBeVisible({ timeout: 60_000 });
  // The summary interpretation first, so both writes of the stored explanation do not race.
  await expect(page.getByTestId("explanation")).toContainText(/figures checked against the computed results|could not be matched/, { timeout: 90_000 });
  return page.getByTestId("ask-chart");
}

for (const option of OPTIONS) {
  test(`Ask about a chart: "${option.label}" sends that chart and shows its answer`, async ({ page }) => {
    test.setTimeout(240_000);
    const panel = await openDashboard(page);
    await panel.getByTestId("ask-chart-select").selectOption(option.value);
    const input = panel.getByTestId("ask-chart-input");
    const defaultQuestion = (await input.getAttribute("placeholder")) ?? "";
    expect(defaultQuestion).toMatch(new RegExp(`^What does the ${option.label.toLowerCase()} chart show\\?$`));

    // Hold the request briefly so the loading state is observable even when the answer is instant.
    await page.route("**/api/agent/explain", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.continue();
    });
    // Answers stored by earlier tests on this run are listed too: count, then read the newest.
    const answers = panel.getByTestId("ask-chart-answer");
    const stored = await answers.count();
    const sent = page.waitForRequest((r) => r.url().endsWith("/api/agent/explain") && r.method() === "POST");
    await panel.getByTestId("ask-chart-button").click();
    expect((await sent).postDataJSON()).toMatchObject({ runId, chart: option.value, followUp: defaultQuestion });
    await expect(panel.getByTestId("ask-chart-loading")).toContainText(`Asking about the ${option.label.toLowerCase()} chart`);
    await expect(panel.getByTestId("ask-chart-button")).toBeDisabled();

    await expect(answers).toHaveCount(stored + 1, { timeout: 90_000 });
    const answer = answers.last();
    await expect(answer).toHaveAttribute("data-chart", option.value);
    await expect(panel.getByTestId("ask-chart-loading")).toHaveCount(0);
    await expect(answer).toContainText(option.label);
    await expect(answer).toContainText(defaultQuestion);
    await expect(answer.getByTestId("ask-chart-answer-text")).toHaveText(/\S.{40,}/s);
    await expect(answer).toContainText(/figures? checked against the computed results|could not be matched/);
    await expect(panel.getByTestId("ask-chart-error")).toHaveCount(0);
    if ((await answer.getAttribute("data-source")) === "rules") await expect(answer.getByTestId("ask-chart-answer-text")).toHaveText(option.automatic);
    await page.unroute("**/api/agent/explain");

    // A typed question about the same chart is answered too (Enter submits).
    await input.fill(option.question);
    await input.press("Enter");
    await expect(answers).toHaveCount(stored + 2, { timeout: 90_000 });
    const typed = answers.last();
    await expect(typed).toHaveAttribute("data-chart", option.value);
    await expect(typed).toContainText(option.question);
    await expect(typed.getByTestId("ask-chart-answer-text")).toHaveText(/\S.{40,}/s);
    await expect(input).toHaveValue("");
  });
}

test("Ask about a chart: failures show a clear error and the charts stay available", async ({ page }) => {
  test.setTimeout(240_000);
  const panel = await openDashboard(page);

  // The request itself fails.
  await page.route("**/api/agent/explain", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { status: 503, title: "The answer service is unavailable" } }) }));
  const answers = panel.getByTestId("ask-chart-answer");
  const stored = await answers.count();
  await panel.getByTestId("ask-chart-select").selectOption("anomalies");
  await panel.getByTestId("ask-chart-button").click();
  const error = panel.getByTestId("ask-chart-error");
  await expect(error).toContainText("The answer service is unavailable.");
  await expect(error).toContainText("The charts and tables above remain available.");
  await expect(page.locator('[data-testid="series-chart"] .main-svg').first()).toBeVisible();
  await expect(panel.getByTestId("ask-chart-button")).toBeEnabled();
  await page.unroute("**/api/agent/explain");

  // The AI provider fails on the server: its message is shown with the automatic answer for the chart.
  await page.route("**/api/agent/explain", async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ response, json: { ...body, source: "rules", aiError: "The AI provider did not answer in time.", aiStatus: "The AI provider did not answer in time. This automatic answer is built from the selected chart's data." } });
  });
  await panel.getByTestId("ask-chart-select").selectOption("seasonal");
  await panel.getByTestId("ask-chart-button").click();
  await expect(answers).toHaveCount(stored + 1, { timeout: 90_000 });
  const answer = answers.last();
  await expect(answer).toHaveAttribute("data-chart", "seasonal");
  await expect(answer.getByTestId("ask-chart-ai-error")).toContainText("The AI assistant failed: The AI provider did not answer in time.");
  await expect(answer.getByTestId("ask-chart-answer-text")).toHaveText(/\S.{40,}/s);
  await expect(error).toHaveCount(0);
  await expect(page.locator('[data-testid="series-chart"] .main-svg').first()).toBeVisible();

  const axe = await new AxeBuilder({ page }).include('[data-testid="explanation"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations.filter((v) => ["serious", "critical"].includes(v.impact ?? "")).map((v) => v.id)).toEqual([]);
});
