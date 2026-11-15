"use client";

/** Save to Neon (random read-only code) and CSV/PDF downloads of the same run. */
import { useState } from "react";
import { ErrorIcon } from "./icons";

async function download(body: Record<string, string>, fallbackName: string): Promise<void> {
  const response = await fetch("/api/exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})))?.error?.title ?? "The export failed.");
  const blob = await response.blob();
  const name = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export function ResultActions({ runId, code: savedCode }: { runId?: string; code?: string }) {
  const [code, setCode] = useState<string | null>(savedCode ?? null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const source: Record<string, string> = savedCode ? { code: savedCode } : { runId: runId ?? "" };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/investigations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }), signal: AbortSignal.timeout(20_000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.title ?? "Saving failed.");
      setCode(data.code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const exportAs = async (format: "csv" | "series" | "pdf") => {
    setBusy(format);
    setError(null);
    try {
      await download({ format, ...source }, `cryonova.${format === "pdf" ? "pdf" : "csv"}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card stack" aria-labelledby="share-title" data-testid="result-actions">
      <h3 id="share-title" style={{ margin: 0 }}>
        Save and download
      </h3>
      <div className="actions-row" data-testid="actions-row">
        {!savedCode && (
          <button type="button" className="btn btn-primary btn-small" onClick={save} disabled={saving || !runId || code !== null} data-testid="save-button">
            {saving ? "Saving…" : code ? "Saved" : "Save investigation"}
          </button>
        )}
        <button type="button" className="btn btn-secondary btn-small" onClick={() => exportAs("csv")} disabled={busy !== null}>
          {busy === "csv" ? "Preparing…" : "Download CSV (results)"}
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => exportAs("series")} disabled={busy !== null}>
          {busy === "series" ? "Preparing…" : "Download CSV (monthly series)"}
        </button>
        <button type="button" className="btn btn-secondary btn-small" onClick={() => exportAs("pdf")} disabled={busy !== null} data-testid="pdf-button">
          {busy === "pdf" ? "Preparing…" : "Download PDF report"}
        </button>
      </div>
      {!savedCode && code && (
        <div className="alert alert-ok" role="status">
          <div className="stack" style={{ width: "100%" }}>
            <div>
              Saved. Retrieval code: <strong className="mono" data-testid="retrieval-code" style={{ fontSize: "1.2rem" }}>{code}</strong>
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-secondary btn-small"
                onClick={async () => {
                  await navigator.clipboard?.writeText(code).catch(() => undefined);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy code"}
              </button>
              <span className="field-help">Anyone with this code can open a read-only copy from the home page. Keep it to share the investigation.</span>
            </div>
          </div>
        </div>
      )}
      {error && (
        <p className="alert alert-error" role="alert">
          <ErrorIcon /> {error}
        </p>
      )}
    </section>
  );
}
