"use client";

/**
 * Minimal Plotly wrapper. Plotly is loaded on the client only, on first use.
 * The figure carries the accessible name; every chart also has a data table.
 */
import { useEffect, useRef } from "react";

export interface PlotSpec {
  data: unknown[];
  layout: Record<string, unknown>;
}

interface PlotProps extends PlotSpec {
  ariaLabel: string;
  className?: string;
  testId?: string;
}

const CONFIG = {
  responsive: true,
  displaylogo: false,
  modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d", "toggleSpikelines"],
  toImageButtonOptions: { format: "png", scale: 3 },
};

export function Plot({ data, layout, ariaLabel, className = "chart-frame", testId }: PlotProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    let purge: ((el: HTMLElement) => void) | null = null;
    import("plotly.js-cartesian-dist-min").then((module) => {
      const plotly = (module as unknown as { default?: typeof module.default }).default ?? (module as unknown as typeof module.default);
      if (cancelled) return;
      purge = plotly.purge;
      void plotly.react(element, data, layout, CONFIG);
    });
    return () => {
      cancelled = true;
      if (purge) purge(element);
    };
  }, [data, layout]);

  // A named figure rather than role="img": Plotly adds focusable toolbar buttons, and an image may not contain controls.
  return (
    <figure className="chart-figure" aria-label={ariaLabel} data-testid={testId}>
      <div ref={ref} className={className} />
    </figure>
  );
}
