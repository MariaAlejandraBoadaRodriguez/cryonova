"use client";

/**
 * Opens a saved investigation by code without an account. The code is sent
 * in a POST body (never in the URL). The view is a faithful, read-only copy;
 * "Refresh with live data" starts a new run with the same selection.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Explanation } from "@/src/agent/explain";
import type { InvestigationSnapshot } from "@/src/db/investigations";
import { fmtUtc } from "@/src/lib/format";
import { ErrorIcon } from "./RegionPicker";
import { ResultActions } from "./ResultActions";
import { ResultsView } from "./ResultsView";

const TITLES: Record<string, string> = { chart: "What the chart shows", pattern: "Pattern", change: "How much it changed", uncertainty: "Uncertainty", source: "Where the data come from", limitations: "Limitations" };

export function OpenWithCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [snapshot, setSnapshot] = useState<InvestigationSnapshot | null>(null);
  const [openedCode, setOpenedCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
      setSnapshot(data.snapshot as InvestigationSnapshot);
      setOpenedCode(code.trim().toUpperCase());
    } catch {
      setError("Cryonova could not be reached. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!snapshot) return;
    setRefreshing(true);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ selection: snapshot.result.selection, parentRunId: snapshot.runId }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.title ?? "The refresh could not start.");
      router.push(`/investigate?run=${data.id}`);
    } catch (e) {
      setError((e as Error).message);
      setRefreshing(false);
    }
  };

  const explanation = (snapshot?.explanation?.summaries?.en ?? snapshot?.explanation?.summary ?? null) as Explanation | null;

  return (
    <div className="stack">
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
      {snapshot && (
        <div className="stack" data-testid="saved-investigation">
          <div className="alert alert-ok" role="status">
            <div>
              <strong>Saved investigation</strong> · saved {fmtUtc(snapshot.savedAt)} · data fetched {fmtUtc(snapshot.result.sources[0]?.fetchedFrom)} – {fmtUtc(snapshot.result.sources[0]?.fetchedTo)}. This is the exact stored result; it does not query the providers.
            </div>
          </div>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={refresh} disabled={refreshing}>
              {refreshing ? "Starting…" : "Refresh with live data"}
            </button>
            <span className="field-help">Runs the same selection again against the providers; it becomes a new investigation with its own code if saved.</span>
          </div>
          {snapshot.question && <p className="headline">“{snapshot.question}”</p>}
          <ResultsView result={snapshot.result} />
          {explanation?.sections && (
            <section className="card stack" aria-labelledby="saved-explain">
              <h3 id="saved-explain">Interpretation {explanation.source === "ai" ? "(AI, saved)" : "(automatic, saved)"}</h3>
              <dl className="kv">
                {Object.entries(explanation.sections).map(([k, text]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt>{TITLES[k] ?? k}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
              </dl>
              <span className="badge">
                ✓ {explanation.verification.verified} of {explanation.verification.checked} figures checked
              </span>
            </section>
          )}
          <ResultActions code={openedCode} />
        </div>
      )}
    </div>
  );
}
