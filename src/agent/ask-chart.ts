/**
 * "Ask about a chart": the charts the interpretation panel can ask about,
 * their labels and default questions, and the browser request that sends a
 * question together with the selected chart. Shared by the panel (browser)
 * and the explanation service (server), so every dropdown option maps to the
 * chart facts the agent receives. No server-only imports here. English only
 * (D-35): labels keep the `{ en }` shape and requests carry no language.
 */
import type { Explanation } from "./explain";

export const CHART_KINDS = ["series", "anomalies", "seasonal"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

/** Dropdown labels, matching the chart titles on the dashboard. */
export const CHART_LABELS: Record<ChartKind, { en: string }> = {
  series: { en: "Series and trend" },
  anomalies: { en: "Monthly anomalies" },
  seasonal: { en: "Seasonal cycle" },
};

/** Sent when Ask is pressed without a typed question. */
export const DEFAULT_QUESTIONS: Record<ChartKind, string> = {
  series: "What does the series and trend chart show?",
  anomalies: "What does the monthly anomalies chart show?",
  seasonal: "What does the seasonal cycle chart show?",
};

export const MIN_QUESTION_LENGTH = 2;
export const MAX_QUESTION_LENGTH = 400;

export function isChartKind(value: unknown): value is ChartKind {
  return typeof value === "string" && (CHART_KINDS as readonly string[]).includes(value);
}

/** The question sent for a chart: the typed one, or the chart's default question when the box is empty. */
export function chartQuestion(chart: ChartKind, typed: string): string {
  const text = typed.trim();
  return text.length >= MIN_QUESTION_LENGTH ? text.slice(0, MAX_QUESTION_LENGTH) : DEFAULT_QUESTIONS[chart];
}

export interface AskRequest {
  runId: string;
  chart: ChartKind;
  followUp: string;
}

type ProblemBody = { error?: { title?: string; detail?: string } } | null;

const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);

/** A readable message for a failed request; the dashboard stays usable either way. */
export function askErrorMessage(status: number, body: ProblemBody): string {
  const title = body?.error?.title;
  const detail = body?.error?.detail;
  if (title || detail) return sentence([title, detail].filter(Boolean).join(": "));
  if (status === 504 || status === 408) return "The answer took too long to arrive.";
  if (status >= 500) return `The server could not produce an answer (HTTP ${status}).`;
  return `The question was not accepted (HTTP ${status}).`;
}

/**
 * Posts one question about the selected chart and resolves with the answer.
 * Rejects with a readable message when the request fails or no answer comes back.
 */
export async function askAboutChart(body: AskRequest, fetchImpl: typeof fetch = fetch, timeoutMs = 90_000): Promise<Explanation> {
  let response: Response;
  try {
    response = await fetchImpl("/api/agent/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "The answer took too long to arrive." : "The server could not be reached. Check the connection and try again.");
  }
  const data = (await response.json().catch(() => null)) as (Explanation & ProblemBody) | null;
  if (!response.ok) throw new Error(askErrorMessage(response.status, data));
  if (!data || typeof data.answer !== "string" || data.answer.trim() === "") throw new Error("The server returned no answer for this chart.");
  return data;
}
