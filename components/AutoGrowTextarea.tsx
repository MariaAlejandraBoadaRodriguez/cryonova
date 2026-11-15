"use client";

/**
 * A textarea whose height follows its content: at least `minRows` lines and at
 * most `maxRows` (then it scrolls), or always the whole text when `maxRows` is
 * left out. The height is measured on a hidden twin with the same classes and
 * width, so the visible field never collapses while measuring (which would
 * make a scrolled panel jump).
 */
import { type CSSProperties, type TextareaHTMLAttributes, useCallback, useEffect, useLayoutEffect, useRef } from "react";

export interface AutoGrowTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Lines shown when empty or short (default 1). */
  minRows?: number;
  /** Lines before the field scrolls; omit to always show the whole text. */
  maxRows?: number;
}

/** Out of sight and out of the accessibility tree; zero height so scrollHeight is the content height. */
const TWIN: CSSProperties = {
  visibility: "hidden",
  position: "absolute",
  top: 0,
  left: 0,
  height: 0,
  minHeight: 0,
  maxHeight: "none",
  paddingTop: 0,
  paddingBottom: 0,
  overflow: "hidden",
  pointerEvents: "none",
};

/** Inner height for content of `contentHeight` px, kept between the row limits; `scrolls` when it does not fit. */
function fitHeight(contentHeight: number, lineHeight: number, minRows: number, maxRows?: number): { height: number; scrolls: boolean } {
  const min = minRows * lineHeight;
  const max = maxRows ? maxRows * lineHeight : Number.POSITIVE_INFINITY;
  return { height: Math.min(max, Math.max(min, contentHeight)), scrolls: contentHeight > max + 1 };
}

export function AutoGrowTextarea({ minRows = 1, maxRows, className, rows, ...props }: AutoGrowTextareaProps) {
  const field = useRef<HTMLTextAreaElement>(null);
  const twin = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = field.current;
    const shadow = twin.current;
    if (!el || !shadow) return;
    const style = window.getComputedStyle(el);
    if (!parseFloat(style.width)) return; // not laid out yet (hidden panel)
    shadow.style.width = style.width;
    // A trailing newline only starts a new line once something follows it.
    shadow.value = `${el.value || el.placeholder || "x"}${el.value.endsWith("\n") ? " " : ""}`;
    const content = shadow.scrollHeight;
    shadow.value = "x";
    const lineHeight = parseFloat(style.lineHeight) || shadow.scrollHeight;
    const { height, scrolls } = fitHeight(content, lineHeight, minRows, maxRows);
    const frame =
      style.boxSizing === "border-box"
        ? parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth)
        : 0;
    el.style.height = `${Math.ceil(height + frame)}px`;
    el.style.overflowY = scrolls ? "auto" : "hidden";
  }, [minRows, maxRows]);

  // Measure before paint whenever the text changes.
  useLayoutEffect(() => resize(), [resize, props.value, props.placeholder]);

  // Wrapping changes with the width (panel resize, rotation) and when the web fonts arrive.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    let width = el.getBoundingClientRect().width;
    const observer = new ResizeObserver(([entry]) => {
      const next = entry?.contentRect.width ?? width;
      if (Math.abs(next - width) < 0.5) return;
      width = next;
      resize();
    });
    observer.observe(el);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.addEventListener("loadingdone", resize);
    void fonts?.ready.then(resize);
    return () => {
      observer.disconnect();
      fonts?.removeEventListener("loadingdone", resize);
    };
  }, [resize]);

  return (
    <>
      <textarea ref={field} className={className} rows={rows ?? minRows} {...props} />
      <textarea ref={twin} className={className} style={TWIN} rows={1} tabIndex={-1} readOnly aria-hidden="true" />
    </>
  );
}
