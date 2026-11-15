"use client";

/**
 * Center top: the question for the research assistant. Its reply fills the
 * setup as an editable proposal and is shown as a card in the right panel;
 * here only a short acknowledgement (with a link to that card) or an error.
 */
import { useId } from "react";
import { AutoGrowTextarea } from "@/components/AutoGrowTextarea";
import { PROPOSAL_ID } from "./AssistantProposal";

interface AssistantPanelProps {
  value: string;
  asking: boolean;
  /** A proposal from the last question is shown in the right panel. */
  answered: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onAsk: () => void;
}

export function AssistantPanel({ value, asking, answered, error, onChange, onAsk }: AssistantPanelProps) {
  const id = useId();
  const canAsk = !asking && value.trim().length >= 2;
  return (
    <section className="ws-area-assistant" aria-labelledby={`${id}-label`} data-testid="assistant">
      <div className="ws-ask-wrap">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canAsk) onAsk();
          }}
        >
          <label className="ws-step" id={`${id}-label`} htmlFor={`${id}-q`}>
            <span className="ws-step-num">02 / </span>Ask a climate question
          </label>
          <div className="ws-ask">
            <AutoGrowTextarea
              id={`${id}-q`}
              minRows={1}
              maxRows={4}
              value={value}
              maxLength={600}
              enterKeyHint="send"
              placeholder="How has temperature changed in Colombia since 2005?"
              aria-describedby={`${id}-keys`}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={(e) => {
                // Enter asks; Shift+Enter keeps the default (a new line). Never while an IME is composing.
                if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                if (canAsk) e.currentTarget.form?.requestSubmit();
              }}
              data-testid="assistant-input"
            />
            <button type="submit" className="ws-btn ws-btn-neon" disabled={!canAsk} data-testid="investigate-button">
              {asking ? "Thinking…" : "Investigate"}
            </button>
          </div>
          <span className="visually-hidden" id={`${id}-keys`}>
            Enter asks the assistant; Shift+Enter adds a new line.
          </span>
        </form>
        {error ? (
          <p className="alert alert-error ws-ask-note" role="alert">
            {error}
          </p>
        ) : (
          answered &&
          !asking && (
            <p className="ws-ask-note ws-ack">
              <span aria-hidden="true">✓ </span>Proposal ready. <a href={`#${PROPOSAL_ID}`}>Review the proposal</a>
            </p>
          )
        )}
      </div>
    </section>
  );
}
