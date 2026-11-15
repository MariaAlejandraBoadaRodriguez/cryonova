"use client";

/** Live dashboard of one run: progress (with cancel) until it finishes, then the full results. */
import Link from "next/link";
import { useEffect, useState } from "react";
import type { StoredExplanations } from "@/src/agent/explain-service";
import type { PublicRun } from "@/src/jobs/service";
import { TERMINAL_STATUSES, type RunResult } from "@/src/jobs/types";
import { fmtDuration } from "@/src/lib/format";
import { setupHref } from "@/src/plan/url";
import { SelectionSchema } from "@/src/jobs/selection";
import { ErrorIcon } from "../icons";
import { DashboardBar, DashboardView } from "./DashboardView";

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

export function RunDashboard({ runId }: { runId: string }) {
  const [run, setRun] = useState<PublicRun | null>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Poll until the run is terminal. Each poll is short; the server resumes stalled runs.
  useEffect(() => {
    let stopped = false;
    let delay = 800;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const response = await fetch(`/api/runs/${runId}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        if (response.status === 404) {
          setMissing(true);
          return;
        }
        if (response.ok) {
          const data = (await response.json()) as PublicRun;
          setRun(data);
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
    timer = setTimeout(tick, 100);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId]);

  const active = run !== null && !TERMINAL_STATUSES.includes(run.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);

  const cancel = async () => {
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  };

  if (missing) {
    return (
      <div className="alert alert-error" role="alert">
        <ErrorIcon />
        <div>
          <strong>This run does not exist.</strong> <Link href="/">Start a new investigation</Link>.
        </div>
      </div>
    );
  }
  if (!run) {
    return (
      <p role="status" className="card">
        Loading the run…
      </p>
    );
  }

  const selection = SelectionSchema.safeParse(run.selection);
  const backHref = selection.success ? setupHref({ ...selection.data, question: run.question ?? selection.data.question }) : "/";
  const result = run.result as RunResult | null;
  const progressPct = run.progress.tasksTotal ? Math.round((((run.progress.tasksDone ?? 0) + (run.progress.tasksFailed ?? 0)) / Math.max(1, run.progress.tasksTotal - (run.progress.tasksMissing ?? 0))) * 100) : 0;

  if (active) {
    return (
      <div className="stack">
        <header className="dash-head">
          <p className="dash-kicker">Cryonova / Evidence lab</p>
          <h1>{run.question ?? "Live analysis"}</h1>
        </header>
        <section className="card stack" role="status" aria-live="polite" data-testid="run-progress">
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
            <Link className="btn btn-ghost btn-small" href={backHref}>
              Back to setup
            </Link>
            <span className="field-help">You can leave this page; the run continues and resumes when you return.</span>
          </div>
        </section>
      </div>
    );
  }

  if (run.status === "cancelled" || run.status === "failed" || !result) {
    return (
      <div className="stack">
        <header className="dash-head">
          <p className="dash-kicker">Cryonova / Evidence lab</p>
          <h1>{run.question ?? "Live analysis"}</h1>
        </header>
        {run.status === "cancelled" ? (
          <div className="alert alert-info" role="status">
            The run was cancelled after {run.progress.tasksDone ?? 0} months had been read.
          </div>
        ) : (
          <div className="alert alert-error" role="alert">
            <ErrorIcon />
            <div>
              <strong>The live query failed.</strong>
              <div>{run.error?.message}</div>
              {run.error?.host && <div className="mono">Provider: {run.error.host}</div>}
            </div>
          </div>
        )}
        <p>
          <Link className="btn btn-secondary" href={backHref} data-testid="back-to-setup">
            ← Back to setup
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <DashboardBar result={result} question={run.question} mode={{ kind: "live", runId: run.id, stored: run.explanation as StoredExplanations | null }} />
      <DashboardView result={result} question={run.question} mode={{ kind: "live", runId: run.id, stored: run.explanation as StoredExplanations | null }} />
    </div>
  );
}
