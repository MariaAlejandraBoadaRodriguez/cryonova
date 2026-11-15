"use client";

/**
 * Left column: investigation setup (case, variables, period, location).
 * Exactly one location mode is active; the globe and these fields edit the
 * same draft, so everything here is a keyboard path for the map actions.
 */
import { useId, useMemo, useState } from "react";
import { collectionOf, getVariable, TOPICS, VARIABLES } from "@/src/catalog";
import { type BBox, countryOptions, REGIONS } from "@/src/catalog/regions";
import { searchCatalog } from "@/src/catalog/search";
import type { CatalogVariable } from "@/src/catalog/types";
import { MAX_VARIABLES } from "@/src/jobs/selection";
import { fmtMonth } from "@/src/lib/format";
import { validateBBox } from "@/src/providers/grid";
import { type LocationState, type Plan, type PlanDraft, sharedCoverage } from "@/src/plan/plan";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COUNTRIES = countryOptions();
const NAMED_REGIONS = REGIONS.filter((r) => r.kind === "region");
const IMERG_GROUP = { id: "imerg", title: "Precipitation from satellites (GPM IMERG)", variables: ["imerg.precipitation"] };

interface SetupPanelProps {
  draft: PlanDraft;
  plan: Plan;
  topicId: string;
  showOutlines: boolean;
  drawing: boolean;
  onTopic: (topicId: string) => void;
  onVariables: (keys: string[]) => void;
  onPeriod: (start: string, end: string) => void;
  onSuggestedPeriod: () => void;
  onLocation: (location: LocationState) => void;
  onToggleOutlines: (value: boolean) => void;
  onToggleDrawing: () => void;
}

function MonthYear({ id, label, value, minYear, maxYear, onChange }: { id: string; label: string; value: string; minYear: number; maxYear: number; onChange: (v: string) => void }) {
  const [year, month] = value.split("-");
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => String(maxYear - i));
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className="ws-label">{label}</legend>
      <div className="ws-pair">
        <select id={`${id}-m`} aria-label={`${label} month`} value={month} onChange={(e) => onChange(`${year}-${e.target.value}`)}>
          {MONTHS.map((name, i) => (
            <option key={name} value={String(i + 1).padStart(2, "0")}>
              {name}
            </option>
          ))}
        </select>
        <select id={`${id}-y`} aria-label={`${label} year`} value={year} onChange={(e) => onChange(`${e.target.value}-${month}`)}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
    </fieldset>
  );
}

function VariableRow({ v, checked, disabled, onToggle }: { v: CatalogVariable; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const c = collectionOf(v);
  return (
    <label className="ws-var">
      <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={onToggle} aria-describedby={`meta-${v.key}`} />
      <span>
        {v.name.en}
        <span className="meta" id={`meta-${v.key}`}>
          {v.display.units} · {c.shortName} v{c.version} · {c.temporal.start}→{c.temporal.end ?? "now"}
          {v.domain === "land" ? " · land only" : ""}
        </span>
      </span>
    </label>
  );
}

/** Typed coordinates for the custom area; re-initialized whenever the box changes elsewhere (e.g. drawn on the globe). */
function CustomArea({ bbox, drawing, onApply, onToggleDrawing }: { bbox: BBox | null; drawing: boolean; onApply: (bbox: BBox) => void; onToggleDrawing: () => void }) {
  const id = useId();
  const [coords, setCoords] = useState(() => ({
    north: bbox ? String(bbox.north) : "",
    south: bbox ? String(bbox.south) : "",
    west: bbox ? String(bbox.west) : "",
    east: bbox ? String(bbox.east) : "",
  }));
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const next = { west: Number(coords.west), south: Number(coords.south), east: Number(coords.east), north: Number(coords.north) };
    const problem = Object.values(coords).some((v) => v.trim() === "") ? "Fill in all four coordinates." : validateBBox(next);
    setError(problem);
    if (!problem) onApply(next);
  };
  return (
    <>
      <div className="coord-grid" style={{ marginTop: 8 }}>
        {(["north", "south", "west", "east"] as const).map((side) => (
          <div key={side}>
            <label className="ws-label" htmlFor={`${id}-${side}`} style={{ marginTop: 4 }}>
              {side[0]!.toUpperCase() + side.slice(1)} (°)
            </label>
            <input id={`${id}-${side}`} type="number" inputMode="decimal" step="0.01" value={coords[side]} onChange={(e) => setCoords((c) => ({ ...c, [side]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="ws-btn ws-btn-outline" onClick={apply}>
          Apply coordinates
        </button>
        <button type="button" className={drawing ? "ws-btn ws-btn-neon" : "ws-btn ws-btn-outline"} aria-pressed={drawing} onClick={onToggleDrawing}>
          {drawing ? "Drag on the globe…" : "Draw on the globe"}
        </button>
      </div>
      {error && (
        <p className="ws-hint" role="alert" style={{ color: "#ffb4a8" }}>
          {error}
        </p>
      )}
      <p className="ws-hint">{bbox ? "Active area shown in yellow on the globe. " : "No area yet. "}West greater than east crosses the 180° meridian.</p>
    </>
  );
}

export function SetupPanel(props: SetupPanelProps) {
  const { draft, plan, topicId, showOutlines, drawing } = props;
  const id = useId();
  const [query, setQuery] = useState("");
  const coverage = sharedCoverage(draft.variables);
  const thisYear = new Date().getUTCFullYear();

  const groups = useMemo(() => {
    if (query.trim()) return [{ id: "search", title: `Matches for “${query.trim()}”`, variables: searchCatalog(query, 20).map((h) => h.variable.key) }];
    return [...TOPICS.map((t) => ({ id: t.id, title: t.title.en, variables: t.variables })), IMERG_GROUP];
  }, [query]);

  const toggle = (key: string) => {
    if (draft.variables.includes(key)) props.onVariables(draft.variables.filter((k) => k !== key));
    else if (draft.variables.length < MAX_VARIABLES) props.onVariables([...draft.variables, key]);
  };

  const periodChecks = plan.checks.filter((c) => /complete (calendar )?years|Period comparison/.test(c.text));

  return (
    <section className="ws-area-setup" aria-labelledby={`${id}-title`} data-testid="setup">
      <p className="ws-step">
        <span className="ws-step-num">01 / </span>Investigate
      </p>
      <h2 className="ws-title" id={`${id}-title`}>
        Investigation setup
      </h2>

      <div className="ws-card">
        <label className="ws-label" htmlFor={`${id}-case`} style={{ marginTop: 0 }}>
          Investigation case
        </label>
        <select id={`${id}-case`} value={topicId} onChange={(e) => props.onTopic(e.target.value)}>
          <option value="">Custom selection</option>
          {TOPICS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title.en}
            </option>
          ))}
        </select>
      </div>

      <div className="ws-section">
        <span className="ws-label" id={`${id}-vars`}>
          Variables ({draft.variables.length}/{MAX_VARIABLES})
        </span>
        {draft.variables.length === 0 ? (
          <p className="ws-hint">None selected. Pick a case above or browse the catalog.</p>
        ) : (
          <ul className="ws-tags" aria-labelledby={`${id}-vars`}>
            {draft.variables.map((key) => {
              const v = getVariable(key);
              return (
                <li key={key} className="ws-tag" title={v ? `${v.display.units} · ${collectionOf(v).shortName}` : key}>
                  {v?.name.en ?? key}
                  <button type="button" aria-label={`Remove ${v?.name.en ?? key}`} onClick={() => toggle(key)}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <label className="ws-label" htmlFor={`${id}-search`}>
          Browse or search the catalog
        </label>
        <input id={`${id}-search`} type="search" placeholder="e.g. temperature, lluvia, soil" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="ws-catalog" role="group" aria-label="Catalog variables by topic">
          {groups.map((g) => (
            <details key={g.id} open={Boolean(query.trim()) || g.variables.some((k) => draft.variables.includes(k))}>
              <summary>{g.title}</summary>
              {g.variables
                .map((k) => getVariable(k))
                .filter((v): v is CatalogVariable => Boolean(v))
                .map((v) => (
                  <VariableRow key={v.key} v={v} checked={draft.variables.includes(v.key)} disabled={draft.variables.length >= MAX_VARIABLES} onToggle={() => toggle(v.key)} />
                ))}
            </details>
          ))}
          {groups[0]?.variables.length === 0 && <p className="ws-hint" style={{ padding: 10 }}>No variable matches. Try a single word.</p>}
        </div>
        <p className="ws-hint">{VARIABLES.length} live-verified variables from NASA MERRA-2 and GPM IMERG.</p>
      </div>

      <div className="ws-section">
        <span className="ws-label" style={{ fontWeight: 700 }}>
          Trend period
        </span>
        <MonthYear id={`${id}-start`} label="Start month" value={draft.start} minYear={Number(coverage.start.slice(0, 4))} maxYear={thisYear} onChange={(v) => props.onPeriod(v, draft.end)} />
        <MonthYear id={`${id}-end`} label="End month" value={draft.end} minYear={Number(coverage.start.slice(0, 4))} maxYear={thisYear} onChange={(v) => props.onPeriod(draft.start, v)} />
        <p className="ws-archive">
          Archive: {fmtMonth(coverage.start)} – {draft.variables.some((k) => getVariable(k) && collectionOf(getVariable(k)!).temporal.end) ? fmtMonth(coverage.end) : "ongoing"}
        </p>
        <button type="button" className="ws-btn ws-btn-outline" style={{ width: "100%" }} onClick={props.onSuggestedPeriod}>
          Use suggested period
        </button>
        {periodChecks.map((c) => (
          <p key={c.text} className="ws-hint" role={c.level === "warn" ? "status" : undefined} style={{ color: c.level === "warn" ? "#ffe08a" : undefined }}>
            {c.level === "warn" ? "⚠ " : "✓ "}
            {c.text}
          </p>
        ))}
      </div>

      <fieldset className="ws-section" style={{ border: 0, padding: 0, margin: "18px 0 0" }}>
        <legend className="ws-label" style={{ fontWeight: 700 }}>
          Location
        </legend>
        <div className="ws-segment" role="radiogroup" aria-label="Location mode">
          <label>
            <input type="radio" name={`${id}-mode`} checked={draft.location.mode === "country"} onChange={() => props.onLocation({ ...draft.location, mode: "country" })} />
            Country or territory
          </label>
          <label>
            <input type="radio" name={`${id}-mode`} checked={draft.location.mode === "custom"} onChange={() => props.onLocation({ ...draft.location, mode: "custom" })} />
            Custom area
          </label>
        </div>
        {draft.location.mode === "country" ? (
          <>
            <label className="ws-label" htmlFor={`${id}-country`}>
              Country or territory
            </label>
            <select id={`${id}-country`} value={draft.location.regionId ?? ""} onChange={(e) => props.onLocation({ ...draft.location, regionId: e.target.value || null })}>
              <option value="">Choose a country…</option>
              <optgroup label="Countries and territories">
                {COUNTRIES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.names.en}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Larger regions">
                {NAMED_REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.names.en}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="ws-hint">Or click a country on the globe.</p>
          </>
        ) : (
          <>
            <CustomArea
              key={draft.location.customBBox ? JSON.stringify(draft.location.customBBox) : "empty"}
              bbox={draft.location.customBBox}
              drawing={drawing}
              onApply={(bbox) => props.onLocation({ mode: "custom", regionId: draft.location.regionId, customBBox: bbox })}
              onToggleDrawing={props.onToggleDrawing}
            />
          </>
        )}
      </fieldset>

      <label className="ws-check">
        <input type="checkbox" checked={showOutlines} onChange={(e) => props.onToggleOutlines(e.target.checked)} />
        Country outlines
      </label>
      <div className="ws-legend" aria-hidden="true">
        <span>
          <i style={{ background: "var(--neon)" }} /> Selected location
        </span>
        <span>
          <i style={{ background: "var(--sky)", boxShadow: "0 0 0 2px #fff" }} /> Sample location (click to select)
        </span>
      </div>
    </section>
  );
}
