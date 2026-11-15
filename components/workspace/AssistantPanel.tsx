"use client";

/** Center top: the research assistant. Replies are in English and fill the setup as an editable proposal. */
import { useEffect, useId, useRef } from "react";

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  details?: string[];
  badge?: string;
}

interface AssistantPanelProps {
  value: string;
  asking: boolean;
  thread: ThreadMessage[];
  /** What the assistant will see of the current setup, e.g. "1 variable · Colombia · Jan 2005 → Dec 2024". */
  contextLine: string | null;
  onChange: (value: string) => void;
  onAsk: () => void;
}

export function AssistantPanel({ value, asking, thread, contextLine, onChange, onAsk }: AssistantPanelProps) {
  const id = useId();
  const end = useRef<HTMLDivElement>(null);
  // A block body: scrollIntoView returns a Promise in current Chromium, and an effect may only return a cleanup function.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [thread.length]);
  return (
    <section className="ws-area-assistant" aria-labelledby={`${id}-label`} data-testid="assistant">
      <div className="ws-ask-wrap">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAsk();
          }}
        >
          <label className="ws-step" id={`${id}-label`} htmlFor={`${id}-q`}>
            <span className="ws-step-num">02 / </span>Ask a climate question
          </label>
          <div className="ws-ask">
            <input
              id={`${id}-q`}
              type="text"
              value={value}
              maxLength={600}
              placeholder="How has temperature changed in Colombia since 2005?"
              aria-describedby={`${id}-help`}
              onChange={(e) => onChange(e.target.value)}
              data-testid="assistant-input"
            />
            <button type="submit" className="ws-btn ws-btn-neon" disabled={asking || value.trim().length < 2} data-testid="investigate-button">
              {asking ? "Thinking…" : "Investigate"}
            </button>
          </div>
        </form>
        <p className="ws-hint ws-context" id={`${id}-help`}>
          {contextLine ? <>The assistant sees your setup: {contextLine}.</> : "The assistant proposes variables, a period and a location; you review and edit them."}
        </p>
        {asking && (
          <p className="ws-hint" role="status">
            Searching the catalog, resolving the place and checking live coverage…
          </p>
        )}
        {thread.length > 0 && (
          <div className="ws-thread" role="log" aria-live="polite" aria-label="Conversation with the research assistant" tabIndex={0}>
            {thread.map((m) => (
              <div key={m.id} className={`ws-msg ${m.role === "user" ? "ws-msg-user" : "ws-msg-assistant"}`}>
                {m.badge && <span className="ws-msg-badge">{m.badge}</span>}
                {m.text}
                {m.details && m.details.length > 0 && (
                  <ul>
                    {m.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
      </div>
    </section>
  );
}
