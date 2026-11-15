import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeVariable } from "@/src/analytics/analyze";
import { monthsBetween } from "@/src/analytics/series";
import { askAboutChart, askErrorMessage, CHART_KINDS, CHART_LABELS, chartQuestion, DEFAULT_QUESTIONS, isChartKind } from "@/src/agent/ask-chart";
import { buildFacts, chartAnswerWithRules, chartFacts, explainWithRules, MONTHLY_VALUES_BUDGET } from "@/src/agent/explain";
import { explainRun } from "@/src/agent/explain-service";
import { collectionOf, getVariable } from "@/src/catalog";
import { getRunStore } from "@/src/db/store";
import { SelectionSchema } from "@/src/jobs/selection";
import type { RunResult, VariableResult } from "@/src/jobs/types";

// The AI client is replaced per test; everything else (facts, verifier, service) is real.
const ai = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/src/agent/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/agent/client")>()),
  anthropicClient: () => ({ beta: { messages: { create: ai.create } } }),
}));

/** A run with a seasonal cycle, a warming trend and deterministic month-to-month noise (Colombia, T2M-like). */
function syntheticResult(keys: string[] = ["merra2.T2M"], start = 2015, end = 2024): RunResult {
  const months = monthsBetween(`${start}-01`, `${end}-12`);
  const variables: VariableResult[] = keys.map((key, k) => {
    const variable = getVariable(key)!;
    const c = collectionOf(variable);
    const points = months.map((month, i) => ({
      month,
      value: 298 + k + 1.5 * Math.sin((2 * Math.PI * (Number(month.slice(5)) - 1)) / 12) + (0.3 * i) / 120 + 0.4 * Math.sin(i * 1.7),
      validCells: 100,
      totalCells: 100,
    }));
    const analysis = analyzeVariable({ variable, points, monthsWithGranule: months.length, failedMonths: [], window: { cells: 100, nativeCells: 100, stride: 1, snapped: false } });
    return { key, name: variable.name, source: variable.source, collection: variable.collection, product: c.shortName, version: c.version, dapName: variable.dapName, providerLongName: variable.providerLongName, domain: variable.domain, unitGroup: variable.display.group, aggregation: variable.aggregation, analysis };
  });
  const selection = SelectionSchema.parse({ question: `Did it change in Colombia between ${start} and ${end}?`, region: { bbox: { west: -79, south: -4.2, east: -66.85, north: 12.5 }, name: "Colombia" }, start: `${start}-01`, end: `${end}-12`, variables: keys });
  const source = { collection: variables[0]!.collection, version: variables[0]!.version, provider: "GES_DISC", conceptId: "C1276812863-GES_DISC", doi: null, fetchedFrom: "2026-11-15T10:00:00Z", fetchedTo: "2026-11-15T10:01:00Z", monthsRead: months.length };
  return {
    schemaVersion: 1,
    runId: crypto.randomUUID(),
    status: "succeeded",
    createdAt: "2026-11-15T10:00:00Z",
    completedAt: "2026-11-15T10:01:00Z",
    selection,
    region: { bbox: selection.region.bbox, name: "Colombia", crossesAntimeridian: false },
    variables,
    sources: [source as unknown as RunResult["sources"][number]],
    timings: { queueMs: 0, discoveryMs: 0, readWallMs: 0, readSumMs: 0, analysisMs: 0, totalMs: 0, invocations: 1, concurrency: 1 },
    warnings: [],
  };
}

async function storedRun(result: RunResult): Promise<string> {
  const store = getRunStore();
  const { run } = await store.createRun({ id: crypto.randomUUID(), selection: result.selection, idempotencyKey: crypto.randomUUID(), clientKey: null });
  await store.acquireLease(run.id, "test", 60_000);
  await store.finishRun(run.id, "test", { status: "succeeded", progress: { phase: "done" }, result });
  return run.id;
}

const aiReply = (answer: string) => ({
  model: "claude-sonnet-5-5",
  stop_reason: "end_turn",
  usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  content: [{ type: "text", text: JSON.stringify({ chart: "", pattern: "", change: "", uncertainty: "", source: "", limitations: "", answer }) }],
});

beforeEach(() => {
  // Never reach Neon or a real AI provider from unit tests.
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("DATABASE_URL_UNPOOLED", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  ai.create.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("chart options", () => {
  it("every dropdown option has an English label and a default question", () => {
    expect([...CHART_KINDS]).toEqual(["series", "anomalies", "seasonal"]);
    for (const kind of CHART_KINDS) {
      expect(CHART_LABELS[kind].en.length).toBeGreaterThan(0);
      expect(Object.keys(CHART_LABELS[kind])).toEqual(["en"]);
      expect(DEFAULT_QUESTIONS[kind]).toMatch(/chart show\?$/);
      expect(isChartKind(kind)).toBe(true);
    }
    expect(CHART_LABELS.anomalies.en).toBe("Monthly anomalies");
    expect(CHART_LABELS.seasonal.en).toBe("Seasonal cycle");
    expect(isChartKind("ranking")).toBe(false);
    expect(isChartKind(undefined)).toBe(false);
  });

  it("an empty box asks the selected chart's default question; a typed question is kept", () => {
    expect(chartQuestion("anomalies", "")).toBe(DEFAULT_QUESTIONS.anomalies);
    expect(chartQuestion("seasonal", "  x ")).toBe(DEFAULT_QUESTIONS.seasonal);
    expect(chartQuestion("seasonal", "  Which month is highest?  ")).toBe("Which month is highest?");
    expect(chartQuestion("series", "a".repeat(500))).toHaveLength(400);
  });
});

describe("browser request for a chart question", () => {
  const body = { runId: "00000000-0000-4000-8000-000000000000", chart: "anomalies" as const, followUp: "What does the monthly anomalies chart show?" };

  it("posts the selected chart and question and returns the answer", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ chart: "anomalies", answer: "Bars show departures." }), { status: 200 }));
    const answer = await askAboutChart(body, fetchImpl as unknown as typeof fetch);
    expect(answer.answer).toBe("Bars show departures.");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/agent/explain");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
  });

  it("rejects with a readable message on server errors, empty answers and network failures", async () => {
    const problem = async () => new Response(JSON.stringify({ error: { title: "Run not found" } }), { status: 404 });
    await expect(askAboutChart(body, problem as unknown as typeof fetch)).rejects.toThrow("Run not found");
    const empty = async () => new Response(JSON.stringify({ chart: "anomalies", answer: "  " }), { status: 200 });
    await expect(askAboutChart(body, empty as unknown as typeof fetch)).rejects.toThrow("no answer for this chart");
    const notJson = async () => new Response("<html>Bad gateway</html>", { status: 502 });
    await expect(askAboutChart(body, notJson as unknown as typeof fetch)).rejects.toThrow("HTTP 502");
    const offline = async () => {
      throw new TypeError("fetch failed");
    };
    await expect(askAboutChart(body, offline as unknown as typeof fetch)).rejects.toThrow("could not be reached");
    const slow = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    await expect(askAboutChart(body, slow as unknown as typeof fetch)).rejects.toThrow("took too long");
    expect(askErrorMessage(504, null)).toMatch(/took too long/);
    expect(askErrorMessage(422, { error: { title: "Invalid request", detail: "chart is expected." } })).toBe("Invalid request: chart is expected.");
  });
});

describe("chart facts sent to the agent", () => {
  const result = syntheticResult();

  it("includes the selected chart's method and plotted values for every option", () => {
    const series = buildFacts(result, "series").selectedChart;
    expect(series.kind).toBe("series");
    expect(series.method).toMatch(/annual means of complete years/);
    expect(series.method).toMatch(/Newey/);
    expect(series.variables[0]).toMatchObject({ key: "merra2.T2M", units: "°C" });
    expect((series.variables[0] as { annualMeans: unknown[] }).annualMeans).toHaveLength(10);
    expect((series.variables[0] as { monthlyMeans: unknown[] }).monthlyMeans).toHaveLength(120);

    const anomalies = buildFacts(result, "anomalies").selectedChart;
    expect(anomalies.method).toMatch(/minus the mean of the same calendar month over 2015-01 to 2024-12/);
    const a = anomalies.variables[0] as { monthsWithAnomaly: number; positiveMonths: number; negativeMonths: number; monthlyAnomalies: unknown[]; meanAnomalyByYear: unknown[]; largestPositive: { anomaly: number } | null; largestNegative: { anomaly: number } | null };
    expect(a.monthsWithAnomaly).toBe(120);
    expect(a.positiveMonths + a.negativeMonths).toBeLessThanOrEqual(120);
    expect(a.positiveMonths).toBeGreaterThan(0);
    expect(a.monthlyAnomalies).toHaveLength(120);
    expect(a.meanAnomalyByYear).toHaveLength(10);
    expect(a.largestPositive!.anomaly).toBeGreaterThan(0);
    expect(a.largestNegative!.anomaly).toBeLessThan(0);

    const seasonal = buildFacts(result, "seasonal").selectedChart;
    expect(seasonal.method).toMatch(/Mean of each calendar month/);
    const s = seasonal.variables[0] as { calendarMonthMeans: Array<{ month: string; years: number }>; highestMonth: { month: string } | null; seasonalRange: number | null };
    expect(s.calendarMonthMeans).toHaveLength(12);
    expect(s.calendarMonthMeans[0]).toMatchObject({ month: "January", years: 10 });
    expect(s.highestMonth?.month).toBe("April");
    expect(s.seasonalRange).toBeGreaterThan(2);
  });

  it("lists yearly values and the last months instead of every month for large runs", () => {
    const big = syntheticResult(["merra2.T2M", "merra2.T2MDEW", "merra2.QV2M", "merra2.PS", "merra2.TS"], 2005, 2024);
    expect(big.variables.length * 240).toBeGreaterThan(MONTHLY_VALUES_BUDGET);
    const facts = chartFacts(big, "anomalies");
    const first = facts.variables[0] as { monthlyAnomalies?: unknown[]; recentMonthlyAnomalies?: unknown[]; meanAnomalyByYear: unknown[] };
    expect(first.monthlyAnomalies).toBeUndefined();
    expect(first.recentMonthlyAnomalies).toHaveLength(24);
    expect(first.meanAnomalyByYear).toHaveLength(20);
    expect(facts.listing).toMatch(/last 24 months/);
  });
});

describe("rule-based answers for every chart", () => {
  const result = syntheticResult();

  it.each(CHART_KINDS)("answers about the %s chart with figures that match the computed results", (chart) => {
    const e = explainWithRules(result, chart, "What does this chart show?");
    expect(e.source).toBe("rules");
    expect(e.chart).toBe(chart);
    expect(e.followUp).toBe("What does this chart show?");
    expect(e.sections).toBeNull();
    expect(e.answer?.length).toBeGreaterThan(80);
    expect(e.verification.checked).toBeGreaterThan(3);
    expect(e.verification.unverified).toEqual([]);
  });

  it("describes what each chart plots", () => {
    expect(chartAnswerWithRules(result, "series")).toMatch(/series and trend chart .* The trend is [+-]\d+\.\d{2} °C\/decade/);
    const anomalies = chartAnswerWithRules(result, "anomalies");
    expect(anomalies).toMatch(/monthly anomalies chart/);
    expect(anomalies).toMatch(/\d+ of 120 months were above their calendar-month mean/);
    expect(anomalies).toMatch(/largest positive anomaly was \+\d+\.\d{2} °C in [A-Z][a-z]+ 20\d{2}/);
    const seasonal = chartAnswerWithRules(result, "seasonal");
    expect(seasonal).toMatch(/seasonal cycle chart/);
    expect(seasonal).toMatch(/highest monthly mean is in April \(\d+\.\d{2} °C\)/);
    expect(seasonal).toMatch(/Each month's mean uses 10 years of data/);
  });

  it("covers several variables and keeps every figure verified", () => {
    const multi = syntheticResult(["merra2.T2M", "merra2.T2MDEW", "merra2.QV2M", "merra2.PS"]);
    for (const chart of CHART_KINDS) {
      const e = explainWithRules(multi, chart, "Compare the variables.");
      expect(e.answer?.split("\n\n")).toHaveLength(4);
      expect(e.answer).toMatch(/same chart for the other variables is in their cards above/);
      expect(e.verification.unverified).toEqual([]);
    }
  });

  it("keeps the summary sections unchanged without a follow-up", () => {
    const e = explainWithRules(result);
    expect(e.answer).toBeNull();
    expect(e.sections?.chart).toMatch(/monthly regional mean/);
    expect(e.verification.unverified).toEqual([]);
  });
});

describe("explanation service: every chart option gets an answer", () => {
  it.each(CHART_KINDS)("answers a %s question without an AI key, from the chart's data", async (chart) => {
    const result = syntheticResult();
    const runId = await storedRun(result);
    const outcome = await explainRun({ runId, clientKey: "no-ai", chart, followUp: DEFAULT_QUESTIONS[chart] });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const e = outcome.explanation;
    expect(e).toMatchObject({ source: "rules", chart, followUp: DEFAULT_QUESTIONS[chart], sections: null });
    expect(e.answer).toBe(chartAnswerWithRules(result, chart));
    expect(e.answer).toMatch(new RegExp(CHART_LABELS[chart].en, "i"));
    expect(e.answer).not.toMatch(/Free-form questions need the AI assistant/);
    expect(e.aiStatus).toMatch(/AI is not configured/);
    expect(e.aiError).toBeUndefined();
    const stored = (await getRunStore().getRun(runId))?.explanation as { followUps?: Array<{ chart: string }> };
    expect(stored.followUps?.map((f) => f.chart)).toEqual([chart]);
  });

  it.each(CHART_KINDS)("sends the %s chart's data and method to the AI and returns its answer", async (chart) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    ai.create.mockResolvedValueOnce(aiReply("The chart answer from the AI."));
    const runId = await storedRun(syntheticResult());
    const outcome = await explainRun({ runId, clientKey: `ai-${chart}`, chart, followUp: "Which month stands out?" });
    expect(outcome.ok && outcome.explanation).toMatchObject({ source: "ai", chart, answer: "The chart answer from the AI.", sections: null });
    const request = ai.create.mock.calls[0]![0] as { messages: Array<{ content: string }>; system: Array<{ text: string }> };
    const payload = JSON.parse(request.messages[0]!.content) as { followUp: string; selectedChart: string; FACTS: ReturnType<typeof buildFacts> };
    expect(payload.followUp).toBe("Which month stands out?");
    expect(payload.selectedChart).toBe(chart);
    expect(payload.FACTS.selectedChart.kind).toBe(chart);
    expect(payload.FACTS.selectedChart.method.length).toBeGreaterThan(40);
    const data = payload.FACTS.selectedChart.variables[0] as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(expect.arrayContaining(chart === "anomalies" ? ["monthlyAnomalies", "meanAnomalyByYear"] : chart === "seasonal" ? ["calendarMonthMeans", "seasonalRange"] : ["annualMeans", "monthlyMeans", "trendLine"]));
    expect(request.system[0]!.text).toMatch(/Never leave "answer" empty/);
  });

  it("shows a clear AI error and still answers from the chart when the provider fails", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    ai.create.mockRejectedValueOnce(new Error("socket hang up"));
    const runId = await storedRun(syntheticResult());
    const outcome = await explainRun({ runId, clientKey: "ai-fails", chart: "seasonal", followUp: "Which month is highest?" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.explanation).toMatchObject({ source: "rules", chart: "seasonal", aiError: "The AI step failed unexpectedly." });
    expect(outcome.explanation.aiStatus).toMatch(/^The AI step failed unexpectedly\. This automatic answer is built from the selected chart's data\.$/);
    expect(outcome.explanation.answer).toMatch(/seasonal cycle chart/);
  });

  it("treats an empty AI answer as a failure and falls back to the chart's answer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    ai.create.mockResolvedValueOnce(aiReply(""));
    const runId = await storedRun(syntheticResult());
    const outcome = await explainRun({ runId, clientKey: "ai-empty", chart: "anomalies", followUp: "What does the monthly anomalies chart show?" });
    expect(outcome.ok && outcome.explanation).toMatchObject({ source: "rules", chart: "anomalies", aiError: "The AI assistant returned an empty answer." });
    expect(outcome.ok && outcome.explanation.answer).toMatch(/monthly anomalies chart/);
  });

  it("still serves the cached summary for the series chart", async () => {
    const runId = await storedRun(syntheticResult());
    const first = await explainRun({ runId, clientKey: "summary" });
    const second = await explainRun({ runId, clientKey: "summary" });
    expect(first.ok && second.ok && second.explanation.createdAt === first.explanation.createdAt).toBe(true);
    expect(first.ok && first.explanation.sections?.chart).toMatch(/monthly regional mean/);
  });
});
