"use client";

/**
 * Evidence label with a short "How to read this" explanation. The trigger is
 * a real button (keyboard and touch); it toggles the text, Escape or a tap
 * elsewhere closes it, and screen readers get the text as its description.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { EvidenceLevel } from "@/src/analytics/analyze";
import { EVIDENCE_NAME, evidenceMeaning } from "@/src/reports/narrative";

export function EvidenceHint({ level, corrected, testId }: { level: EvidenceLevel; corrected: boolean; testId?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const name = EVIDENCE_NAME[level];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const strong = level === "significant";
  return (
    <span className="evidence" ref={ref} data-testid={testId} data-level={level}>
      <span className={strong ? "badge badge-strong" : level === "nominal" ? "badge badge-possible" : "badge badge-neutral"}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          {strong ? <circle cx="5" cy="5" r="5" fill="#EAFE07" /> : <circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" strokeWidth="2" />}
        </svg>
        {name}
      </span>
      <button type="button" className="evidence-help" aria-expanded={open} aria-controls={id} aria-describedby={id} aria-label={`How to read this: ${name}`} title="How to read this" onClick={() => setOpen((v) => !v)}>
        <span aria-hidden="true">?</span>
      </button>
      <span id={id} className="evidence-tip" hidden={!open}>
        <strong>{name}.</strong> {evidenceMeaning(level, corrected)}
      </span>
    </span>
  );
}
