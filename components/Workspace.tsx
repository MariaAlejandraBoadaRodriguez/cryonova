"use client";

/**
 * Investigation workspace: one shared selection for manual and agent-led
 * modes, run progress with cancellation, and results.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { collectionOf, getVariable } from "@/src/catalog";
import { monthsBetween } from "@/src/analytics/series";
import type { PublicRun } from "@/src/jobs/service";
import { SelectionSchema, type Selection } from "@/src/jobs/selection";
import { TERMINAL_STATUSES, type RunResult } from "@/src/jobs/types";
import { fmtDuration } from "@/src/lib/format";
import { detectLanguage } from "@/src/agent/language";
import type { Proposal } from "@/src/agent/proposal";
import { ProposalCard } from "./AgentPanel";
import { ExplanationPanel } from "./ExplanationPanel";
import { PeriodPicker } from "./PeriodPicker";
import { ErrorIcon, RegionPicker, type RegionValue } from "./RegionPicker";
import { ResultActions } from "./ResultActions";
import { ResultsView } from "./ResultsView";
import { VariablePicker } from "./VariablePicker";

export interface Draft {
  question: string;
  region: RegionValue;
  start: string;
  end: string;
  variables: string[];
  mode: Selection["mode"];
}

const CURRENT_YEAR = new Date().getUTCFullYear();

export function toSelection(draft: Draft) {
  return {
    question: draft.question.trim() || undefined,
    region: { bbox: draft.region.bbox, name: draft.region.name, regionId: draft.region.regionId, source: draft.region.source },
    start: draft.start,
    end: draft.end,
    variables: draft.variables,
    mode: draft.mode,
  };
}

function phaseText(run: PublicRun): string {
  const p = run.progress;
  if (run.status === "queued" && p.phase !== "queued") return p.message ?? "Waiting to resume…";
  switch (p.phase) {
    case "queued":
      return "Queued — starting the live query…";
    case "discovering":
      return "Finding monthly granules in NASA CMR…";
    case "reading":
      return `Reading monthly subsets from NASA OPeNDAP: ${p.tasksDone ?? 0} of ${(p.tasksTotal ?? 0) - (p.tasksMissing ?? 0)} done${p.tasksFailed ? `, ${p.tasksFailed} failed` : ""}…`;
    case "analyzing":
      return "Computing regional means, trends and uncertainty…";
    default:
      return p.message ?? "Finishing…";
  }
}

export function Workspace({ initialQuestion, initialRunId }: { initialQuestion: string; initialRunId: string | null }) {
  const [draft, setDraft] = useState<Draft>({
    question: initialQuestion,
    region: { bbox: null, source: "coordinates" },
    start: "2005-01",
    end: "2024-12",
    variables: [],
    mode: "manual",
  });
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [runId, setRunId] = useState<string | null>(initialRunId);
  const [run, setRun] = useState<PublicRun | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{ title: string; detail?: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [regionVersion, setRegionVersion] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const autoProposed = useRef(false);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setIdempotencyKey(crypto.randomUUID());
  }, []);

  const validation = useMemo(() => {
    if (!draft.region.bbox) return { ok: false as const, messages: ["Select a region: search a name, enter coordinates or draw a rectangle."] };
    const parsed = SelectionSchema.safeParse(toSelection(draft));
    return parsed.success ? { ok: true as const, selection: parsed.data } : { ok: false as const, messages: [...new Set(parsed.error.issues.map((i) => i.message))] };
  }, [draft]);

  const estimate = useMemo(() => {
    const months = draft.start <= draft.end ? monthsBetween(draft.start, draft.end).length : 0;
    const collections = new Set(draft.variables.map((k) => getVariable(k)?.collection).filter(Boolean)).size;
    const reads = months * collections;
    return { reads, seconds: Math.round((reads * 1.4) / 6) };
  }, [draft.start, draft.end, draft.variables]);

  const yearBounds = useMemo(() => {
    const starts = draft.variables.map((k) => getVariable(k)).filter(Boolean).map((v) => Number(collectionOf(v!).temporal.start.slice(0, 4)));
    return { min: starts.length ? Math.max(...starts) : 1980, max: CURRENT_YEAR };
  }, [draft.variables]);

  const hydrated = useRef(false);
  const hydrateFrom = useCallback((data: PublicRun) => {
    if (hydrated.current) return;
    hydrated.current = true;
    const parsed = SelectionSchema.safeParse(data.selection);
    if (!parsed.success) return;
    const sel = parsed.data;
    setDraft((d) => (d.region.bbox ? d : { question: sel.question ?? "", region: { bbox: sel.region.bbox, name: sel.region.name, regionId: sel.region.regionId, source: sel.region.source }, start: sel.start, end: sel.end, variables: sel.variables, mode: sel.mode }));
    setRegionVersion((v) => v + 1);
  }, []);

  // Poll the run until it finishes. Each poll is short; the server resumes stalled runs.
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let delay = 800;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (response.status === 404) {
          setSubmitError({ title: "This run no longer exists.", detail: "Start a new run." });
          setRunId(null);
          return;
        }
        if (response.ok) {
          const data = (await response.json()) as PublicRun;
          setRun(data);
          hydrateFrom(data);
          if (TERMINAL_STATUSES.includes(data.status)) return;
        }
      } catch {
        // Network hiccup: keep polling with backoff.
      }
      if (!stopped) {
        delay = Math.min(delay * 1.2, 4000);
        timer = setTimeout(tick, delay);
      }
    };
    timer = setTimeout(tick, 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId, hydrateFrom]);

  const active = run !== null && !TERMINAL_STATUSES.includes(run.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (runId) url.searchParams.set("run", runId);
    else url.searchParams.delete("run");
    window.history.replaceState(null, "", url.toString());
  }, [runId]);

  const propose = useCallback(async (question: string) => {
    if (question.trim().length < 3) return;
    setProposing(true);
    setProposalError(null);
    try {
      const response = await fetch("/api/agent/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await response.json();
      if (!response.ok) {
        setProposalError(data.error?.detail ?? data.error?.title ?? "The proposal could not be produced.");
        return;
      }
      const next = data as Proposal;
      setProposal(next);
      const sel = next.selection;
      setDraft((d) => ({
        ...d,
        region: sel.region ? { bbox: sel.region.bbox, name: sel.region.name, regionId: sel.region.regionId, source: "agent" } : d.region,
        start: sel.start,
        end: sel.end,
        variables: sel.variables.length > 0 ? sel.variables : d.variables,
        mode: "guided",
      }));
      setIdempotencyKey(crypto.randomUUID());
      setRegionVersion((v) => v + 1);
    } catch {
      setProposalError("The research agent could not be reached. You can still build the selection manually.");
    } finally {
      setProposing(false);
    }
  }, []);

  useEffect(() => {
    if (autoProposed.current || !initialQuestion.trim() || initialRunId) return;
    autoProposed.current = true;
    void propose(initialQuestion);
  }, [initialQuestion, initialRunId, propose]);

  const submit = async () => {
    if (!validation.ok) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ selection: validation.selection }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) {
        setSubmitError({ title: data.error?.title ?? "The run could not start.", detail: data.error?.detail });
        return;
      }
      setRun(data as PublicRun);
      setRunId((data as PublicRun).id);
      resultsRef.current?.focus();
    } catch {
      setSubmitError({ title: "Cryonova could not be reached.", detail: "Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!run) return;
    await fetch(`/api/runs/${run.id}/cancel`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  };

  const progressPct = run && run.progress.tasksTotal ? Math.round(((run.progress.tasksDone ?? 0) + (run.progress.tasksFailed ?? 0)) / Math.max(1, run.progress.tasksTotal - (run.progress.tasksMissing ?? 0)) * 100) : 0;
  const result = run?.result as RunResult | null | undefined;

  return (
    <div className="page workspace">
      <section aria-labelledby="selection-title" className="stack">
        <h1 id="selection-title" style={{ fontSize: "1.6rem" }}>
          New investigation
        </h1>
        <div className="card stack">
          <p className="step-label">1 · Question (optional)</p>
          <label htmlFor="question">What do you want to find out?</label>
          <textarea
            id="question"
            value={draft.question}
            maxLength={600}
            placeholder="Did near-surface air temperature in Colombia change between 2005 and 2024?"
            onChange={(e) => update({ question: e.target.value })}
          />
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => propose(draft.question)} disabled={proposing || draft.question.trim().length < 3} data-testid="propose-button">
              {proposing ? "Proposing…" : "Propose variables, region and period"}
            </button>
            <span className="field-help">The research agent proposes an editable selection; nothing runs until you press Run.</span>
          </div>
          {proposing && <p role="status">Searching the catalog, resolving the region and checking live coverage…</p>}
          {proposalError && (
            <p className="alert alert-error" role="alert">
              <ErrorIcon /> {proposalError}
            </p>
          )}
          {proposal && <ProposalCard proposal={proposal} />}
        </div>
        <div className="card">
          <p className="step-label">2 · Region</p>
          <RegionPicker key={regionVersion} value={draft.region} onChange={(region) => update({ region })} />
        </div>
        <div className="card stack">
          <p className="step-label">3 · Period</p>
          <PeriodPicker start={draft.start} end={draft.end} minYear={yearBounds.min} maxYear={yearBounds.max} onChange={(p) => update(p)} />
        </div>
        <div className="card">
          <p className="step-label">4 · Variables</p>
          <VariablePicker selected={draft.variables} onChange={(variables) => update({ variables })} />
        </div>
        <div className="card stack">
          {!validation.ok && (
            <ul className="field-help" style={{ margin: 0, paddingLeft: 18 }} aria-live="polite">
              {validation.messages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
          {validation.ok && (
            <p className="field-help" style={{ margin: 0 }}>
              {estimate.reads} live provider reads · roughly {fmtDuration(estimate.seconds * 1000)} with 6 parallel requests.
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={!validation.ok || submitting || active} onClick={submit} data-testid="run-button">
            {submitting ? "Starting…" : active ? "Running…" : "Run live analysis"}
          </button>
        </div>
      </section>

      <section aria-labelledby="results-title" className="stack" ref={resultsRef} tabIndex={-1}>
        <h2 id="results-title" className="visually-hidden">
          Results
        </h2>
        {submitError && (
          <div className="alert alert-error" role="alert">
            <ErrorIcon />
            <div>
              <strong>{submitError.title}</strong>
              {submitError.detail && <div>{submitError.detail}</div>}
            </div>
          </div>
        )}
        {!run && !submitError && (
          <div className="card empty-state">
            <h2 style={{ color: "var(--ink)" }}>Results appear here</h2>
            <p>Choose a region, a period and at least one variable, then press “Run live analysis”. Values are requested from NASA at that moment.</p>
          </div>
        )}
        {run && active && (
          <div className="card stack" role="status" aria-live="polite" data-testid="run-progress">
            <div className="panel-title">
              <h2 style={{ margin: 0 }}>Live query in progress</h2>
              <span className="mono muted">{fmtDuration(now - new Date(run.createdAt).getTime())}</span>
            </div>
            <p style={{ margin: 0 }}>{phaseText(run)}</p>
            <div className="progress-bar" aria-hidden="true">
              <span style={{ width: `${progressPct}%` }} />
            </div>
            <div className="row">
              <button type="button" className="btn btn-ghost btn-small" onClick={cancel} disabled={run.cancelRequested}>
                {run.cancelRequested ? "Cancelling…" : "Cancel run"}
              </button>
              <span className="field-help">You can leave this page; the run continues and resumes when you return.</span>
            </div>
          </div>
        )}
        {run && run.status === "cancelled" && (
          <div className="alert alert-info" role="status">
            The run was cancelled. {run.progress.tasksDone ?? 0} months had been read. Adjust the selection and run again.
          </div>
        )}
        {run && run.status === "failed" && (
          <div className="alert alert-error" role="alert">
            <ErrorIcon />
            <div>
              <strong>The live query failed.</strong>
              <div>{run.error?.message}</div>
              {run.error?.host && <div className="mono">Provider: {run.error.host}</div>}
            </div>
          </div>
        )}
        {result && run && (run.status === "succeeded" || run.status === "partial") && (
          <>
            <ResultsView result={result} />
            <ResultActions runId={run.id} />
            <ExplanationPanel
              key={run.id}
              runId={run.id}
              initialLanguage={detectLanguage(run.question ?? draft.question)}
              stored={run.explanation as import("@/src/agent/explain-service").StoredExplanations | null}
            />
          </>
        )}
      </section>
    </div>
  );
}
