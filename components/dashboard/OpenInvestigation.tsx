"use client";

/**
 * Opens a saved investigation by code without an account and shows it on the
 * same dashboard, read-only. The code travels in a POST body, never in the URL.
 */
import { useRef, useState } from "react";
import type { InvestigationSnapshot } from "@/src/db/investigations";
import { ErrorIcon } from "../icons";
import { DashboardBar, DashboardView } from "./DashboardView";

export function OpenInvestigation() {
  const [code, setCode] = useState("");
  const [opened, setOpened] = useState<{ code: string; snapshot: InvestigationSnapshot } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  const open = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/investigations/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.detail ? `${data.error.title}. ${data.error.detail}` : (data.error?.title ?? "The investigation could not be opened."));
        return;
      }
      setOpened({ code: code.trim().toUpperCase(), snapshot: data.snapshot as InvestigationSnapshot });
      requestAnimationFrame(() => top.current?.focus());
    } catch {
      setError("Cryonova could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (opened) {
    const { snapshot } = opened;
    const mode = { kind: "saved" as const, code: opened.code, savedAt: snapshot.savedAt, runId: snapshot.runId, explanation: snapshot.explanation };
    return (
      <div className="stack" ref={top} tabIndex={-1} data-testid="saved-investigation">
        <DashboardBar result={snapshot.result} question={snapshot.question} mode={mode} />
        <DashboardView result={snapshot.result} question={snapshot.question} mode={mode} />
        <p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setOpened(null)}>
            Open another code
          </button>
        </p>
      </div>
    );
  }

  return (
    <section className="card stack open-card" aria-labelledby="open-title">
      <h1 id="open-title">Open with code</h1>
      <p className="muted" style={{ margin: 0 }}>
        Enter the code you received when saving. No sign-up; the investigation opens read-only on its dashboard.
      </p>
      <form onSubmit={open} className="stack">
        <label htmlFor="code">Retrieval code</label>
        <input id="code" type="text" autoComplete="off" spellCheck={false} placeholder="XXXX-XXXX-XXXX" value={code} maxLength={20} onChange={(e) => setCode(e.target.value)} className="mono" />
        <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length < 12}>
          {busy ? "Opening…" : "Open investigation"}
        </button>
      </form>
      {error && (
        <p className="alert alert-error" role="alert">
          <ErrorIcon /> {error}
        </p>
      )}
    </section>
  );
}
