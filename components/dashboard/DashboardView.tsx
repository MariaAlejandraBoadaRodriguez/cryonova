"use client";

/**
 * Results dashboard for one run, live or reopened by code (read-only):
 * headline finding with the annotated main chart, the other planned analyses,
 * the multi-variable comparison, the verified interpretation, actions and
 * provenance. Everything renders from the run's stored structured result.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Explanation } from "@/src/agent/explain";
import type { StoredExplanations } from "@/src/agent/explain-service";
import { detectLanguage } from "@/src/agent/language";
import type { RunResult, VariableResult } from "@/src/jobs/types";
import { fmtMonth, fmtUtc } from "@/src/lib/format";
import { setupHref } from "@/src/plan/url";
import { qValuesFor, regionLabel } from "@/src/reports/narrative";
import { DiscoveryTable } from "../DiscoveryTable";
import { ExplanationPanel } from "../ExplanationPanel";
import { ErrorIcon } from "../icons";
import { ResultActions } from "../ResultActions";
import { CoverageWarnings, MainFinding, ProvenancePanel, VariableCard } from "../ResultsView";

const SECTION_TITLES: Record<string, string> = { chart: "What the chart shows", pattern: "Pattern", change: "How much it changed", uncertainty: "Uncertainty", source: "Where the data come from", limitations: "Limitations" };

/** The variable the headline is about: the only one, else the strongest evidence after correction. */
export function primaryVariable(result: RunResult): VariableResult | undefined {
  if (result.variables.length <= 1) return result.variables[0];
  const q = qValuesFor(result);
  const ranked = result.variables.filter((v) => v.analysis.trend.status === "ok").sort((a, b) => (q.get(a.key) ?? 2) - (q.get(b.key) ?? 2));
  return ranked[0] ?? result.variables[0];
}

export type DashboardMode =
  | { kind: "live"; runId: string; stored: StoredExplanations | null }
  | { kind: "saved"; code: string; savedAt: string; runId: string; explanation: InvestigationExplanation | null };

type InvestigationExplanation = { summary?: Explanation; summaries?: Record<string, Explanation> };

function SavedInterpretation({ explanation }: { explanation: InvestigationExplanation | null }) {
  const e = (explanation?.summaries?.en ?? explanation?.summary ?? Object.values(explanation?.summaries ?? {})[0] ?? null) as Explanation | null;
  if (!e?.sections) {
    return (
      <section className="card" aria-labelledby="saved-explain">
        <h3 id="saved-explain">Interpretation</h3>
        <p className="muted">No interpretation was saved with this investigation. The charts and tables are the complete result.</p>
      </section>
    );
  }
  return (
    <section className="card stack" aria-labelledby="saved-explain" data-testid="saved-interpretation">
      <h3 id="saved-explain">Interpretation {e.source === "ai" ? "(AI, saved)" : "(automatic, saved)"}</h3>
      <dl className="kv">
        {Object.entries(e.sections).map(([k, text]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{SECTION_TITLES[k] ?? k}</dt>
            <dd>{text}</dd>
          </div>
        ))}
      </dl>
      <span className="badge">
        ✓ {e.verification.verified} of {e.verification.checked} figures checked against the computed results
      </span>
    </section>
  );
}

export function DashboardBar({ result, question, mode }: { result: RunResult; question: string | null; mode: DashboardMode }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selection = result.selection;
  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ selection, parentRunId: mode.runId }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.detail ? `${data.error.title} ${data.error.detail}` : (data.error?.title ?? "The refresh could not start."));
      router.push(`/investigations/${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setRefreshing(false);
    }
  };
  return (
    <>
      <nav className="dash-bar" aria-label="Investigation actions">
        <Link className="btn btn-secondary btn-small" href={setupHref({ ...selection, question: question ?? selection.question })} data-testid="back-to-setup">
          ← Back to setup
        </Link>
        <span className={mode.kind === "saved" ? "pill pill-saved" : "pill pill-live"} data-testid="dashboard-status">
          {mode.kind === "saved" ? `Saved investigation · read-only · saved ${fmtUtc(mode.savedAt)}` : `Live run · fetched ${fmtUtc(result.sources[0]?.fetchedFrom)}`}
        </span>
        <button type="button" className="btn btn-secondary btn-small" onClick={refresh} disabled={refreshing} data-testid="refresh-live">
          {refreshing ? "Starting…" : "Refresh with live data"}
        </button>
      </nav>
      {error && (
        <p className="alert alert-error" role="alert">
          <ErrorIcon /> {error}
        </p>
      )}
    </>
  );
}

export function DashboardView({ result, question, mode }: { result: RunResult; question: string | null; mode: DashboardMode }) {
  const primary = primaryVariable(result);
  const region = regionLabel(result);
  const sources = [...new Set(result.sources.map((s) => `${s.collection} v${s.version}`))].join(", ");
  return (
    <div className="stack" data-testid="dashboard">
      <header className="dash-head">
        <p className="step-label">Investigation results</p>
        <h1>{question ?? `${primary?.name.en ?? "Trend"} in ${region}`}</h1>
        <p className="dash-meta">
          <span>{region}</span>
          <span>
            {fmtMonth(result.selection.start)} – {fmtMonth(result.selection.end)}
          </span>
          <span>
            {result.variables.length} variable{result.variables.length === 1 ? "" : "s"}
          </span>
          <span>{sources}</span>
        </p>
        {mode.kind === "saved" && (
          <p className="field-help" style={{ margin: 0 }}>
            This is the exact stored result; it does not query the providers. Data were fetched {fmtUtc(result.sources[0]?.fetchedFrom)} – {fmtUtc(result.sources[0]?.fetchedTo)}.
          </p>
        )}
      </header>

      <CoverageWarnings result={result} />

      {primary && (
        <section className="card dash-headline" aria-labelledby="headline-title" data-testid="headline-finding">
          <p className="step-label">Headline finding</p>
          <h2 id="headline-title">
            {primary.name.en} · {region}
          </h2>
          <MainFinding v={primary} result={result} />
        </section>
      )}

      {result.variables.length > 1 && <DiscoveryTable result={result} />}

      {result.variables.map((v, i) => (
        <VariableCard key={v.key} v={v} result={result} index={i} showMain={v.key !== primary?.key} />
      ))}

      {mode.kind === "live" ? (
        <ExplanationPanel key={mode.runId} runId={mode.runId} initialLanguage={detectLanguage(question ?? "")} stored={mode.stored} />
      ) : (
        <SavedInterpretation explanation={mode.explanation} />
      )}

      {mode.kind === "live" ? <ResultActions runId={mode.runId} /> : <ResultActions code={mode.code} />}

      <ProvenancePanel result={result} />
    </div>
  );
}
