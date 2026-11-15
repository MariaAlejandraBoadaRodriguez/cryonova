"use client";

/**
 * Right panel, top: the assistant's latest reply as a readable card (what it
 * proposed, why, and that everything on the left stays editable). A proposal
 * changes nothing until the user presses "Apply proposal". The wrapper is a
 * polite live region that is always mounted, so screen readers hear each new
 * proposal even though it appears away from the question field; it is not
 * atomic, so applying announces only the short "Applied" line.
 */

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  details?: string[];
  badge?: string;
}

/** Element id of the card, the target of the "Proposal ready" link in the center column. */
export const PROPOSAL_ID = "assistant-proposal";

interface AssistantProposalProps {
  /** The assistant's latest turn: the proposal, then an optional clarifying question. */
  reply: ThreadMessage[];
  asking: boolean;
  /** Present while a proposal can be applied to the setup. */
  onApply?: () => void;
  applied?: boolean;
}

export function AssistantProposal({ reply, asking, onApply, applied = false }: AssistantProposalProps) {
  const [main, ...rest] = reply;
  return (
    <div role="status" aria-live="polite" aria-atomic="false" className="proposal-live">
      {(asking || main) && (
        <article className="guide-card proposal-card" id={PROPOSAL_ID} tabIndex={-1} aria-labelledby={`${PROPOSAL_ID}-title`} data-testid="assistant-proposal">
          <div className="proposal-head">
            <h3 className="guide-kicker" id={`${PROPOSAL_ID}-title`}>
              Assistant proposal
            </h3>
            {!asking && main?.badge && <span className="pill pill-saved">{main.badge}</span>}
          </div>
          {asking || !main ? (
            <p className="proposal-working">Searching the catalog, resolving the place and checking live coverage…</p>
          ) : (
            <>
              <p className="proposal-text">{main.text}</p>
              {main.details && main.details.length > 0 && (
                <ul className="proposal-details">
                  {main.details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
              {rest.map((m) => (
                <p key={m.id} className="proposal-followup">
                  {m.badge && <strong>{m.badge}: </strong>}
                  {m.text}
                </p>
              ))}
              {onApply && (
                <div className="proposal-actions">
                  <button type="button" className="ws-btn ws-btn-primary" onClick={onApply} data-testid="apply-proposal">
                    Apply proposal
                  </button>
                  <span className="proposal-applied" data-testid="proposal-status">
                    {applied ? "Applied to the setup and the plan." : "Nothing on the left changes until you apply it."}
                  </span>
                </div>
              )}
            </>
          )}
        </article>
      )}
    </div>
  );
}
