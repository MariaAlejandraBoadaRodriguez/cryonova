/**
 * Horizontally scrollable table container. It is a named, focusable region so
 * keyboard users can scroll it (WCAG 2.1.1; axe scrollable-region-focusable).
 */
import type { CSSProperties, ReactNode } from "react";

export function TableWrap({ label, style, children }: { label: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0} style={style}>
      {children}
    </div>
  );
}
