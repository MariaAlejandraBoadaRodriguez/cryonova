"use client";

/**
 * Right column. Initial state: the guide with an example investigation and
 * follow-up questions (clicking pre-fills the setup; no numbers are shown as
 * live). Ready state: the investigation plan with Start analysis.
 */
import Link from "next/link";
import { useId, useState } from "react";
import { EXAMPLE, type ExampleInvestigation, FOLLOW_UPS } from "@/src/plan/examples";
import type { Plan } from "@/src/plan/plan";

export interface ProgressItem {
  label: string;
  done: boolean;
  detail: string;
}

interface GuidePanelProps {
  plan: Plan;
  view: "guide" | "plan";
  canShowPlan: boolean;
  progress: ProgressItem[];
  starting: boolean;
  startError: string | null;
  suggestedQuestion: string | null;
  onView: (view: "guide" | "plan") => void;
  onUseExample: (example: ExampleInvestigation) => void;
  onQuestion: (question: string) => void;
  onStart: () => void;
}

function GuideHead({ titleId }: { titleId: string }) {
  return (
    <div className="guide-head">
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel-art guide from the approved prototype, rendered pixelated */}
      <img src="/brand/detective.png" width={150} height={177} alt="" />
      <div>
        <p className="ws-step" style={{ margin: 0 }}>
          Your climate investigation guide
        </p>
        <h2 className="guide-title" id={titleId}>
          Earth Trend Detective
        </h2>
      </div>
    </div>
  );
}

function SavedExample({ onUse }: { onUse: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="guide-card guide-card-featured" data-testid="example-card">
      <span className="guide-kicker">Example investigation · Saved run, fetched {EXAMPLE.savedPreview.fetched}</span>
      <h3>{EXAMPLE.question}</h3>
      <p>Colombia · January 2005 – December 2024 · Near-surface air temperature (MERRA-2 T2M). Using it fills the setup; a new run queries NASA again.</p>
      <div className="guide-actions">
        <button type="button" className="ws-btn ws-btn-primary" onClick={onUse} data-testid="use-example">
          Use this investigation
        </button>
        <button type="button" className="ws-btn ws-btn-link" aria-expanded={open} aria-controls="saved-example-result" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide saved result" : "Show saved result"}
        </button>
      </div>
      <div id="saved-example-result" hidden={!open}>
        <div className="cr-stat">
          <strong>{EXAMPLE.savedPreview.headline.split(" (")[0]}</strong>
          <span>{EXAMPLE.savedPreview.headline.includes("(") ? `(${EXAMPLE.savedPreview.headline.split(" (")[1]}` : ""}</span>
        </div>
        <p>
          Saved result, not live: {EXAMPLE.savedPreview.detail}. Data fetched {EXAMPLE.savedPreview.fetched}.
        </p>
        <Link className="ws-btn ws-btn-link" href={`/investigations/${EXAMPLE.savedPreview.runId}`}>
          Open the saved run’s dashboard
        </Link>
      </div>
    </article>
  );
}

export function GuidePanel(props: GuidePanelProps) {
  const { plan, view, canShowPlan, progress, starting, startError, suggestedQuestion } = props;
  const id = useId();
  // The default period is always valid, so it does not count as the user having started.
  const started = progress.some((p) => p.done && p.label !== "Period");
  return (
    <aside className="ws-area-guide" aria-labelledby={`${id}-title`} data-testid="guide">
      <GuideHead titleId={`${id}-title`} />

      {view === "guide" ? (
        <>
          {!started ? (
            <p className="guide-intro">
              Ask a plain-language question in English or Spanish, or start from the example below. I use the place and dates in your question first, then your globe pick and the dates on the left. Nothing runs until you press Start analysis.
            </p>
          ) : (
            <section className="guide-progress" aria-labelledby={`${id}-progress`} data-testid="guide-progress">
              <h3 id={`${id}-progress`}>Your plan so far</h3>
              <ul>
                {progress.map((p) => (
                  <li key={p.label} className={p.done ? "check-ok" : "check-info"}>
                    <span aria-hidden="true">{p.done ? "✓" : "○"}</span>
                    <span>
                      <span className="visually-hidden">{p.done ? "Done: " : "Missing: "}</span>
                      <strong>{p.label}</strong> — {p.detail}
                    </span>
                  </li>
                ))}
              </ul>
              {!progress[0]?.done && suggestedQuestion && (
                <button type="button" className="ws-btn ws-btn-primary" onClick={() => props.onQuestion(suggestedQuestion)} data-testid="use-suggested-question">
                  Use the question “{suggestedQuestion}”
                </button>
              )}
              {canShowPlan && (
                <button type="button" className="ws-btn ws-btn-primary" onClick={() => props.onView("plan")}>
                  Back to the plan
                </button>
              )}
            </section>
          )}

          <SavedExample onUse={() => props.onUseExample(EXAMPLE)} />

          <h3 className="guide-subtitle">Follow-up questions</h3>
          <p className="guide-why">Same place and dates; related variables or methods. Each one fills the setup and runs live when you start it.</p>
          <ul className="guide-list">
            {FOLLOW_UPS.map((f) => (
              <li key={f.id}>
                <button type="button" className="guide-live" onClick={() => props.onUseExample(f)} data-testid={`follow-up-${f.id}`}>
                  <span className="guide-kicker">{f.title}</span>
                  <span className="q">{f.question}</span>
                  <span className="guide-why">{f.why}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <section className={plan.blockers.length > 0 ? "plan plan-card has-blockers" : "plan plan-card"} aria-labelledby={`${id}-plan`} data-testid="plan">
          <div className="plan-head">
            <p className="ws-step" style={{ margin: 0 }} id={`${id}-plan`}>
              <span className="ws-step-num">03 / </span>Investigation plan
            </p>
            <button type="button" className="ws-btn ws-btn-link" onClick={() => props.onView("guide")}>
              See examples
            </button>
          </div>
          <label className="plan-label" htmlFor={`${id}-question`}>
            Question to answer
          </label>
          <textarea id={`${id}-question`} rows={2} maxLength={600} value={plan.question} onChange={(e) => props.onQuestion(e.target.value)} data-testid="plan-question" />
          {!plan.question && suggestedQuestion && (
            <button type="button" className="ws-btn ws-btn-link" onClick={() => props.onQuestion(suggestedQuestion)}>
              Use “{suggestedQuestion}”
            </button>
          )}
          <dl>
            <dt>Period</dt>
            <dd data-testid="plan-period">
              {plan.period.label}
              <br />
              <span className="muted">
                {plan.period.months} months · {plan.period.completeYears} complete years
              </span>
            </dd>
            <dt>Location</dt>
            <dd data-testid="plan-location">
              {plan.location ? (
                <>
                  {plan.location.label} <span className="muted">({plan.location.mode === "country" ? "named region" : "custom rectangle"})</span>
                  <br />
                  <span className="mono muted">{plan.location.detail}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
            <dt>Variables</dt>
            <dd data-testid="plan-variables">
              <ul className="plan-list">
                {plan.variables.map((v) => (
                  <li key={v.key}>
                    {v.name}{" "}
                    <span className="muted">
                      ({v.units}; {v.product}, {v.source})
                    </span>
                  </li>
                ))}
                {plan.derived.map((d) => (
                  <li key={d.key}>
                    {d.name} <span className="muted">(derived: {d.formula}; {d.units})</span>
                  </li>
                ))}
              </ul>
            </dd>
            <dt>Primary analysis</dt>
            <dd>{plan.analyses.primary}</dd>
            <dt>Additional analyses</dt>
            <dd>
              <ul className="plan-list">
                {plan.analyses.additional.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </dd>
          </dl>
          <h4 className="plan-subtitle">Data sufficiency and coverage</h4>
          <ul className="plan-checks" data-testid="plan-checks">
            {plan.checks.map((c) => (
              <li key={c.text} className={`check-${c.level}`}>
                <span aria-hidden="true">{c.level === "ok" ? "✓" : c.level === "warn" ? "⚠" : "ℹ"}</span>
                <span>
                  <span className="visually-hidden">{c.level === "warn" ? "Warning: " : c.level === "ok" ? "OK: " : "Note: "}</span>
                  {c.text}
                </span>
              </li>
            ))}
          </ul>
          {plan.blockers.length > 0 && (
            <div className="plan-blockers" id={`${id}-blockers`} data-testid="plan-blockers">
              <strong>Start analysis is disabled until:</strong>
              <ul className="plan-list">
                {plan.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          {startError && (
            <p className="alert alert-error" role="alert">
              {startError}
            </p>
          )}
          <button
            type="button"
            className="ws-btn ws-btn-neon ws-btn-start"
            disabled={!plan.ready || starting}
            aria-describedby={plan.blockers.length > 0 ? `${id}-blockers` : undefined}
            onClick={props.onStart}
            data-testid="start-analysis"
          >
            {starting ? "Starting…" : "Start analysis"}
          </button>
          <p className="field-help">Values are requested live from NASA when you start; nothing is precomputed.</p>
        </section>
      )}
    </aside>
  );
}
