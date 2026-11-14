"use client";

/** Shows the research agent's editable proposal: rationale, assumptions, clarification and tool trace. */
import type { Proposal } from "@/src/agent/proposal";
import { getVariable } from "@/src/catalog";
import { fmtBBox, fmtMonth } from "@/src/lib/format";

export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const es = proposal.language === "es";
  return (
    <div className="stack" data-testid="proposal" aria-live="polite">
      <div className="row">
        <span className={proposal.source === "ai" ? "badge badge-strong" : "badge badge-neutral"}>
          {proposal.source === "ai" ? `AI proposal · ${proposal.ai?.model ?? "Claude"}` : "Rule-based proposal (no AI)"}
        </span>
        {proposal.ready ? <span className="badge">{es ? "Lista para ejecutar" : "Ready to run"}</span> : <span className="badge badge-neutral">{es ? "Falta información" : "Needs input"}</span>}
      </div>
      {proposal.aiStatus && (
        <p className="alert alert-info" role="status" style={{ margin: 0 }}>
          {proposal.aiStatus}
        </p>
      )}
      {proposal.clarification && (
        <p className="alert alert-warn" style={{ margin: 0 }}>
          <strong>{es ? "Pregunta: " : "Question: "}</strong>
          {proposal.clarification}
        </p>
      )}
      <dl className="kv">
        <dt>{es ? "Región" : "Region"}</dt>
        <dd>{proposal.selection.region ? `${proposal.selection.region.name ?? "Custom box"} · ${fmtBBox(proposal.selection.region.bbox)}` : "—"}</dd>
        <dt>{es ? "Periodo" : "Period"}</dt>
        <dd>
          {fmtMonth(proposal.selection.start)} – {fmtMonth(proposal.selection.end)}
        </dd>
        <dt>{es ? "Análisis" : "Analysis"}</dt>
        <dd>{proposal.analysis}</dd>
      </dl>
      {proposal.rationale.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {proposal.rationale.map((r) => (
            <li key={r.key}>
              <strong>{getVariable(r.key)?.name.en ?? r.key}</strong>: {r.text}
            </li>
          ))}
        </ul>
      )}
      {(proposal.assumptions.length > 0 || proposal.notes.length > 0) && (
        <ul className="field-help" style={{ margin: 0, paddingLeft: 18 }}>
          {[...proposal.assumptions, ...proposal.notes].map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {proposal.trace.length > 0 && (
        <details>
          <summary>{es ? "Cómo se construyó la propuesta" : "How the proposal was built"}</summary>
          <ol className="field-help" style={{ paddingLeft: 18 }}>
            {proposal.trace.map((t, i) => (
              <li key={i}>
                <span className="mono">{t.tool}</span> — {t.summary}
              </li>
            ))}
          </ol>
          {proposal.ai && (
            <p className="field-help">
              {proposal.ai.inputTokens} input / {proposal.ai.outputTokens} output tokens · ≈ ${proposal.ai.costUsd.toFixed(4)} · {(proposal.ai.latencyMs / 1000).toFixed(1)} s
            </p>
          )}
        </details>
      )}
      <p className="field-help" style={{ margin: 0 }}>
        {es ? "La selección de abajo se actualizó con esta propuesta. Revísala o edítala y luego ejecuta." : "The selection below now reflects this proposal. Review or edit it, then run."}
      </p>
    </div>
  );
}
