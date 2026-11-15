"use client";

/**
 * Interpretation of a finished run. Explanations come only from the run's
 * computed facts; every cited figure is checked and the result is shown.
 * Always in English (D-35); older non-English summaries are not shown.
 * "Ask about a chart" sends the selected chart with the question (or that
 * chart's default question when the box is empty) and shows the answer.
 */
import { useEffect, useState } from "react";
import { askAboutChart, CHART_KINDS, CHART_LABELS, type ChartKind, chartQuestion, DEFAULT_QUESTIONS, isChartKind, MAX_QUESTION_LENGTH } from "@/src/agent/ask-chart";
import type { Explanation } from "@/src/agent/explain";
import { englishSummary, type StoredExplanations } from "@/src/agent/stored-explanations";
import { ErrorIcon } from "./icons";

const SECTION_TITLES: Record<string, string> = { chart: "What the chart shows", pattern: "Pattern", change: "How much it changed", uncertainty: "Uncertainty", source: "Where the data come from", limitations: "Limitations" };

function Verification({ e }: { e: Explanation }) {
  const v = e.verification;
  if (v.unverified.length === 0) {
    return <span className="badge">✓ {v.checked} figures checked against the computed results</span>;
  }
  return (
    <p className="alert alert-warn" style={{ margin: 0 }}>
      {v.unverified.length} figure(s) could not be matched to the computed results: <span className="mono">{v.unverified.join(", ")}</span>. Rely on the tables above.
    </p>
  );
}

/** The run's summary interpretation (series chart), always in English. */
async function request(body: { runId: string }): Promise<Explanation> {
  const response = await fetch(`/api/runs/${body.runId}/explanation`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.detail ?? data.error?.title ?? "The explanation could not be produced.");
  return data as Explanation;
}

/** One answered question about a chart, with its source, AI status and figure check. */
function ChartAnswer({ f }: { f: Explanation }) {
  const label = CHART_LABELS[isChartKind(f.chart) ? f.chart : "series"].en;
  return (
    <article className="stack" data-testid="ask-chart-answer" data-chart={f.chart} data-source={f.source} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <p style={{ margin: 0 }}>
        <span className="badge badge-neutral">{label}</span> <strong>{f.followUp}</strong>
      </p>
      {f.aiError ? (
        <p className="alert alert-error" data-testid="ask-chart-ai-error" style={{ margin: 0 }}>
          <ErrorIcon /> The AI assistant failed: {f.aiError} The automatic answer below is built from the chart&apos;s data; the charts and tables above remain available.
        </p>
      ) : f.source === "rules" && f.aiStatus ? (
        <p className="alert alert-info" style={{ margin: 0 }}>
          {f.aiStatus}
        </p>
      ) : null}
      <p style={{ margin: 0, whiteSpace: "pre-line" }} data-testid="ask-chart-answer-text">
        {f.answer}
      </p>
      <div className="row">
        <span className={f.source === "ai" ? "badge badge-strong" : "badge badge-neutral"}>{f.source === "ai" ? `Claude · ${f.ai?.model}` : "Automatic answer (no AI)"}</span>
        <Verification e={f} />
      </div>
    </article>
  );
}

export function ExplanationPanel({ runId, stored }: { runId: string; stored?: StoredExplanations | null }) {
  // Only an English summary is shown; without one (e.g. an older run), a fresh English one is requested.
  const [summary, setSummary] = useState<Explanation | null>(() => englishSummary(stored));
  const [followUps, setFollowUps] = useState<Explanation[]>(stored?.followUps ?? []);
  const [loading, setLoading] = useState(() => !englishSummary(stored));
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [chart, setChart] = useState<ChartKind>("series");
  const [asking, setAsking] = useState<ChartKind | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  useEffect(() => {
    if (summary) return;
    let cancelled = false;
    request({ runId })
      .then((e) => !cancelled && setSummary(e))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // Load once per mounted run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // An empty box asks the selected chart's default question, so every option answers on Ask.
  const ask = async () => {
    if (asking) return;
    const selected = chart;
    setAsking(selected);
    setAskError(null);
    try {
      const e = await askAboutChart({ runId, chart: selected, followUp: chartQuestion(selected, question) });
      setFollowUps((list) => [...list, e]);
      setQuestion("");
    } catch (e) {
      setAskError((e as Error).message);
    } finally {
      setAsking(null);
    }
  };

  return (
    <section className="card stack" aria-labelledby="explain-title" data-testid="explanation">
      <div className="panel-title">
        <h3 id="explain-title" style={{ margin: 0 }}>
          Interpretation
        </h3>
      </div>
      {loading && <p role="status">Interpreting the results…</p>}
      {error && (
        <p className="alert alert-error" role="alert">
          <ErrorIcon /> {error} The charts and tables above remain valid.
        </p>
      )}
      {summary && (
        <>
          <div className="row">
            <span className={summary.source === "ai" ? "badge badge-strong" : "badge badge-neutral"}>{summary.source === "ai" ? `Claude · ${summary.ai?.model}` : "Automatic explanation (no AI)"}</span>
            <Verification e={summary} />
          </div>
          {summary.aiStatus && (
            <p className="alert alert-info" role="status" style={{ margin: 0 }}>
              {summary.aiStatus}
            </p>
          )}
          {summary.sections && (
            <dl className="kv">
              {Object.entries(summary.sections).map(([key, text]) => (
                <div key={key} style={{ display: "contents" }}>
                  <dt>{SECTION_TITLES[key] ?? key}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      <div className="stack" data-testid="ask-chart">
        <label htmlFor="followup">Ask about a chart</label>
        <p id="followup-help" className="field-help" style={{ margin: 0 }}>
          Pick a chart and press Ask, or type your own question about it.
        </p>
        <div className="row">
          <select aria-label="Chart" data-testid="ask-chart-select" value={chart} disabled={asking !== null} onChange={(e) => isChartKind(e.target.value) && setChart(e.target.value)} style={{ maxWidth: 200 }}>
            {CHART_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {CHART_LABELS[kind].en}
              </option>
            ))}
          </select>
          <input id="followup" data-testid="ask-chart-input" type="text" maxLength={MAX_QUESTION_LENGTH} value={question} placeholder={DEFAULT_QUESTIONS[chart]} aria-describedby="followup-help" onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask()} style={{ flex: "1 1 220px" }} />
          <button type="button" className="btn btn-secondary btn-small" data-testid="ask-chart-button" onClick={() => void ask()} disabled={asking !== null} aria-busy={asking !== null}>
            {asking ? "Asking…" : "Ask"}
          </button>
        </div>
        {asking && (
          <p role="status" className="muted" data-testid="ask-chart-loading" style={{ margin: 0 }}>
            Asking about the {CHART_LABELS[asking].en.toLowerCase()} chart… This can take up to a minute.
          </p>
        )}
        {askError && (
          <p className="alert alert-error" role="alert" data-testid="ask-chart-error">
            <ErrorIcon /> No answer about the chart: {askError} The charts and tables above remain available.
          </p>
        )}
        <div className="stack" aria-live="polite">
          {followUps.map((f, i) => (
            <ChartAnswer key={i} f={f} />
          ))}
        </div>
      </div>
    </section>
  );
}
