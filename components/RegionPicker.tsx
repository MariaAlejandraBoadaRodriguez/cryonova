"use client";

/**
 * Region selection: search by name (English or Spanish), exact coordinates,
 * or drawing on the map. All three edit the same box.
 */
import dynamic from "next/dynamic";
import { useEffect, useId, useState } from "react";
import type { BBox } from "@/src/catalog/regions";
import { fmtBBox } from "@/src/lib/format";
import { validateBBox } from "@/src/providers/grid";

const MapSelector = dynamic(() => import("./MapSelector"), {
  ssr: false,
  loading: () => (
    <div className="map-frame" role="status">
      <p className="empty-state">Loading map…</p>
    </div>
  ),
});

export interface RegionValue {
  bbox: BBox | null;
  name?: string;
  regionId?: string;
  source: "drawn" | "named" | "coordinates" | "agent";
}

interface RegionHit {
  id: string;
  kind: string;
  names: { en: string; es: string };
  bbox: BBox;
}

export function RegionPicker({ value, onChange }: { value: RegionValue; onChange: (value: RegionValue) => void }) {
  const listId = useId();
  const [query, setQuery] = useState(value.name ?? "");
  const [hits, setHits] = useState<RegionHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [fitKey, setFitKey] = useState("initial");
  const [coords, setCoords] = useState(() => toFields(value.bbox));
  const [coordError, setCoordError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || q === value.name) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/regions?q=${encodeURIComponent(q)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
        .then((r) => r.json())
        .then((d: { regions: RegionHit[] }) => {
          setHits(d.regions);
          setActive(0);
          setOpen(true);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, value.name]);

  const choose = (hit: RegionHit) => {
    setQuery(hit.names.en);
    setOpen(false);
    setCoords(toFields(hit.bbox));
    setCoordError(null);
    setFitKey(`named:${hit.id}`);
    onChange({ bbox: hit.bbox, name: hit.names.en, regionId: hit.id, source: "named" });
  };

  const applyCoords = () => {
    const bbox = { west: Number(coords.west), south: Number(coords.south), east: Number(coords.east), north: Number(coords.north) };
    const problem = Object.values(coords).some((v) => v.trim() === "") ? "Fill in all four coordinates." : validateBBox(bbox);
    setCoordError(problem);
    if (problem) return;
    setFitKey(`coords:${Object.values(bbox).join(",")}`);
    onChange({ bbox, name: undefined, source: "coordinates" });
  };

  const onDrawn = (bbox: BBox) => {
    setDrawing(false);
    setCoords(toFields(bbox));
    setCoordError(null);
    onChange({ bbox, name: undefined, source: "drawn" });
  };

  return (
    <div className="stack">
      <div className="combobox">
        <label htmlFor={`${listId}-input`}>Region by name</label>
        <input
          id={`${listId}-input`}
          type="search"
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `${listId}-opt-${active}` : undefined}
          placeholder="Country or region, e.g. Colombia, Amazon basin, Sahel"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (!open || hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const hit = hits[active];
              if (hit) choose(hit);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && hits.length > 0 && (
          <ul id={`${listId}-list`} role="listbox" aria-label="Matching regions">
            {hits.map((hit, i) => (
              <li
                key={hit.id}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(hit);
                }}
              >
                {hit.names.en}
                {hit.names.es !== hit.names.en ? <span className="muted"> · {hit.names.es}</span> : null}
                <span className="muted"> · {hit.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <MapSelector bbox={value.bbox} drawing={drawing} fitKey={fitKey} onChange={onDrawn} />
      <div className="row">
        <button type="button" className={drawing ? "btn btn-accent btn-small" : "btn btn-secondary btn-small"} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
          {drawing ? "Click two opposite corners…" : value.bbox ? "Redraw rectangle" : "Draw rectangle"}
        </button>
        {value.bbox && (
          <button
            type="button"
            className="btn btn-ghost btn-small"
            onClick={() => {
              setQuery("");
              setCoords(toFields(null));
              onChange({ bbox: null, source: "coordinates" });
            }}
          >
            Delete selection
          </button>
        )}
      </div>

      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Coordinates (decimal degrees)</legend>
        <div className="coord-grid">
          {(["north", "south", "west", "east"] as const).map((side) => (
            <div key={side}>
              <label htmlFor={`${listId}-${side}`} style={{ fontWeight: 500 }}>
                {side[0]!.toUpperCase() + side.slice(1)}
              </label>
              <input
                id={`${listId}-${side}`}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={side === "north" || side === "south" ? -90 : -180}
                max={side === "north" || side === "south" ? 90 : 180}
                value={coords[side]}
                onChange={(e) => setCoords((c) => ({ ...c, [side]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <p className="field-help">West greater than east selects a box that crosses the 180° meridian.</p>
        <button type="button" className="btn btn-secondary btn-small" onClick={applyCoords}>
          Apply coordinates
        </button>
        {coordError && (
          <p className="alert alert-error" role="alert" style={{ marginTop: 10 }}>
            <ErrorIcon /> {coordError}
          </p>
        )}
      </fieldset>

      <p aria-live="polite" className="field-help">
        {value.bbox ? (
          <>
            Selected: <strong>{value.name ?? "Custom box"}</strong> · {fmtBBox(value.bbox)}
          </>
        ) : (
          "No region selected yet."
        )}
      </p>
    </div>
  );
}

function toFields(bbox: BBox | null) {
  return {
    north: bbox ? String(bbox.north) : "",
    south: bbox ? String(bbox.south) : "",
    west: bbox ? String(bbox.west) : "",
    east: bbox ? String(bbox.east) : "",
  };
}

export function ErrorIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v6M12 16.5v.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
