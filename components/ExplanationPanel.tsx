"use client";

/**
 * Interpretation of a finished run. Explanations come only from the run's
 * computed facts; every cited figure is checked and the result is shown.
 */
import { useEffect, useState } from "react";
import type { ChartKind, Explanation } from "@/src/agent/explain";
import type { Language } from "@/src/agent/proposal";
import { ErrorIcon } from "./RegionPicker";

const SECTION_TITLES: Record<Language, Record<string, string>> = {
  en: { chart: "What the chart shows", pattern: "Pattern", change: "How much it changed", uncertainty: "Uncertainty", source: "Where the data come from", limitations: "Limitations" },
  es: { chart: "Qué muestra el gráfico", pattern: "Patrón", change: "Cuánto cambió", uncertainty: "Incertidumbre", source: "De dónde vienen los datos", limitations: "Limitaciones" },
};

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

async function request(body: Record<string, unknown>): Promise<Explanation> {
  const response = await fetch("/api/agent/explain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.detail ?? data.error?.title ?? "The explanation could not be produced.");
  return data as Explanation;
}

export function ExplanationPanel({ runId, initialLanguage, stored }: { runId: string; initialLanguage: Language; stored?: { summary?: Explanation; followUps?: Explanation[] } | null }) {
  const [language, setLanguage] = useState<Language>(stored?.summary?.language ?? initialLanguage);
  const [summary, setSummary] = useState<Explanation | null>(stored?.summary && stored.summary.language === language ? stored.summary : null);
  const [followUps, setFollowUps] = useState<Explanation[]>(stored?.followUps ?? []);
  const [loading, setLoading] = useState(() => !(stored?.summary && stored.summary.language === (stored?.summary?.language ?? initialLanguage)));
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [chart, setChart] = useState<ChartKind>("series");
  const [asking, setAsking] = useState(false);

  const load = (lang: Language) =>
    request({ runId, language: lang, chart: "series" })
      .then((e) => setSummary(e))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    if (summary) return;
    let cancelled = false;
    request({ runId, language, chart: "series" })
      .then((e) => !cancelled && setSummary(e))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // Load once per mounted run; language switches load from the click handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchLanguage = (next: Language) => {
    if (next === language) return;
    setLanguage(next);
    setSummary(null);
    setLoading(true);
    setError(null);
    void load(next);
  };

  const ask = async () => {
    if (question.trim().length < 2) return;
    setAsking(true);
    try {
      const e = await request({ runId, language, chart, followUp: question.trim() });
      setFollowUps((list) => [...list, e]);
      setQuestion("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const titles = SECTION_TITLES[language];
  return (
    <section className="card stack" aria-labelledby="explain-title" data-testid="explanation">
      <div className="panel-title">
        <h3 id="explain-title" style={{ margin: 0 }}>
          {language === "es" ? "Interpretación" : "Interpretation"}
        </h3>
        <div className="row" role="group" aria-label="Explanation language">
          {(["en", "es"] as const).map((l) => (
            <button key={l} type="button" className={l === language ? "btn btn-primary btn-small" : "btn btn-ghost btn-small"} aria-pressed={l === language} onClick={() => switchLanguage(l)}>
              {l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </div>
      {loading && <p role="status">{language === "es" ? "Interpretando los resultados…" : "Interpreting the results…"}</p>}
      {error && (
        <p className="alert alert-error" role="alert">
          <ErrorIcon /> {error} The charts and tables above remain valid.
        </p>
      )}
      {summary && (
        <>
          <div className="row">
            <span className={summary.source === "ai" ? "badge badge-strong" : "badge badge-neutral"}>{summary.source === "ai" ? `Claude · ${summary.ai?.model}` : language === "es" ? "Explicación automática (sin IA)" : "Automatic explanation (no AI)"}</span>
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
                  <dt>{titles[key]}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
      <div className="stack">
        <label htmlFor="followup">{language === "es" ? "Pregunta sobre un gráfico" : "Ask about a chart"}</label>
        <div className="row">
          <select aria-label="Chart" value={chart} onChange={(e) => setChart(e.target.value as ChartKind)} style={{ maxWidth: 200 }}>
            <option value="series">{language === "es" ? "Serie y tendencia" : "Series and trend"}</option>
            <option value="anomalies">{language === "es" ? "Anomalías mensuales" : "Monthly anomalies"}</option>
            <option value="seasonal">{language === "es" ? "Ciclo estacional" : "Seasonal cycle"}</option>
          </select>
          <input id="followup" type="text" maxLength={400} value={question} placeholder={language === "es" ? "¿Cuánto cambió en la década reciente?" : "How much did it change in the last decade?"} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} style={{ flex: "1 1 220px" }} />
          <button type="button" className="btn btn-secondary btn-small" onClick={ask} disabled={asking || question.trim().length < 2}>
            {asking ? "…" : language === "es" ? "Preguntar" : "Ask"}
          </button>
        </div>
        {followUps.map((f, i) => (
          <div key={i} className="stack" style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <p style={{ margin: 0 }}>
              <strong>{f.followUp}</strong>
            </p>
            <p style={{ margin: 0 }}>{f.answer}</p>
            <Verification e={f} />
          </div>
        ))}
      </div>
    </section>
  );
}
