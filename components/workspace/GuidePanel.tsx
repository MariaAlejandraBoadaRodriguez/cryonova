"use client";

/**
 * Right column. Initial state: the guide with an example investigation and
 * follow-up questions (clicking pre-fills the setup; no numbers are shown as
 * live). Ready state: the investigation plan with Start analysis.
 */
import Link from "next/link";
import { useId } from "react";
import { EXAMPLE, type ExampleInvestigation, FOLLOW_UPS } from "@/src/plan/examples";
import type { Plan } from "@/src/plan/plan";

function DetectiveAvatar() {
  // Original pixel-art magnifier badge (no third-party artwork).
  const px = (x: number, y: number, c: string) => <rect key={`${x}-${y}-${c}`} x={x * 4} y={y * 4} width="4" height="4" fill={c} />;
  const ring = [[4, 1], [5, 1], [6, 1], [3, 2], [7, 2], [2, 3], [8, 3], [2, 4], [8, 4], [2, 5], [8, 5], [3, 6], [7, 6], [4, 7], [5, 7], [6, 7]];
  const glass = [[4, 2], [5, 2], [6, 2], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [4, 6], [5, 6], [6, 6]];
  const handle = [[8, 8], [9, 9], [10, 10], [11, 11], [9, 8], [10, 9], [11, 10], [12, 11], [12, 12]];
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
      <rect width="56" height="56" rx="12" fill="#07173F" />
      <g transform="translate(2,2)">
        {glass.map(([x, y]) => px(x!, y!, "#2E96F5"))}
        {[[4, 3], [5, 3], [4, 4]].map(([x, y]) => px(x!, y!, "#9fd3ff"))}
        {ring.map(([x, y]) => px(x!, y!, "#EAFE07"))}
        {handle.map(([x, y]) => px(x!, y!, "#c9a26b"))}
      </g>
    </svg>
  );
}

function FollowUpCard({ example, onUse }: { example: ExampleInvestigation; onUse: (e: ExampleInvestigation) => void }) {
  return (
    <li className="guide-card" data-testid={`follow-up-${example.id}`}>
      <button type="button" className="card-link" onClick={() => onUse(example)}>
        <span className="guide-kicker">{example.title}</span>
        <h3>{example.question}</h3>
        <span className="guide-why">{example.why}</span>
      </button>
      <span className="pill pill-live">Runs live</span>
    </li>
  );
}

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

export function GuidePanel(props: GuidePanelProps) {
  const { plan, view, canShowPlan, progress, starting, startError, suggestedQuestion } = props;
  const id = useId();
  const started = progress.some((p) => p.done);
  return (
    <aside className="ws-area-guide" aria-labelledby={`${id}-title`} data-testid="guide">
      <div className="guide-head">
        <DetectiveAvatar />
        <div>
          <p className="ws-step" style={{ margin: 0 }}>
            Your climate investigation guide
          </p>
          <h2 className="guide-title" id={`${id}-title`}>
            Earth Trend Detective
          </h2>
        </div>
      </div>

      {view === "guide" ? (
        <>
          {!started ? (
            <p className="guide-intro">
              Ask a question in English or Spanish, or start from the example below. The assistant fills the setup on the left as a proposal you can edit; nothing runs until you press Start analysis.
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

          <article className="guide-card guide-card-featured" data-testid="example-card">
            <button type="button" className="card-link" onClick={() => props.onUseExample(EXAMPLE)}>
              <span className="guide-kicker">Example investigation</span>
              <h3>{EXAMPLE.question}</h3>
              <span className="guide-why">Colombia · January 2005 – December 2024 · Near-surface air temperature (MERRA-2 T2M)</span>
            </button>
            <div className="guide-saved">
              <span className="pill pill-saved">Saved example · fetched {EXAMPLE.savedPreview.fetched}</span>
              <p>
                <strong>{EXAMPLE.savedPreview.headline}</strong> — {EXAMPLE.savedPreview.detail}. A new run queries NASA again.
              </p>
            </div>
            <div className="row">
              <button type="button" className="ws-btn ws-btn-primary" onClick={() => props.onUseExample(EXAMPLE)} data-testid="use-example">
                Use this investigation
              </button>
              <Link className="ws-btn ws-btn-link" href={`/investigations/${EXAMPLE.savedPreview.runId}`}>
                Open the saved run
              </Link>
            </div>
          </article>

          <h3 className="guide-subtitle">Follow-up questions</h3>
          <p className="guide-why">Same place and dates, related variables or methods. Each one fills the setup.</p>
          <ul className="guide-list">
            {FOLLOW_UPS.map((f) => (
              <FollowUpCard key={f.id} example={f} onUse={props.onUseExample} />
            ))}
          </ul>
        </>
      ) : (
        <section className="plan" aria-labelledby={`${id}-plan`} data-testid="plan">
          <div className="plan-head">
            <p className="ws-step" style={{ margin: 0 }}>
              <span className="ws-step-num">03 / </span>Investigation plan
            </p>
            <button type="button" className="ws-btn ws-btn-link" onClick={() => props.onView("guide")}>
              See examples
            </button>
          </div>
          <h3 id={`${id}-plan`} className="visually-hidden">
            Investigation plan
          </h3>
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
            <div className="alert alert-warn" id={`${id}-blockers`} data-testid="plan-blockers">
              <div>
                <strong>Start analysis is disabled until:</strong>
                <ul className="plan-list">
                  {plan.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
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
