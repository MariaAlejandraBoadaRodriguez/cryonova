"use client";

/**
 * Left column: investigation setup (case, variables, period, location).
 * Exactly one location mode is active; the globe and these fields edit the
 * same draft, so everything here is a keyboard path for the map actions.
 */
import { useId, useMemo, useState } from "react";
import { collectionOf, getVariable, TOPICS, VARIABLES } from "@/src/catalog";
import { type BBox, countryOptions, REGIONS } from "@/src/catalog/regions";
import { type DerivedMetric, DERIVED, getDerived } from "@/src/catalog/derived";
import { searchCatalog } from "@/src/catalog/search";
import type { CatalogVariable } from "@/src/catalog/types";
import { MAX_VARIABLES } from "@/src/jobs/selection";
import { fmtMonth } from "@/src/lib/format";
import { validateBBox } from "@/src/providers/grid";
import { type LocationState, type Plan, type PlanDraft, sharedCoverage, topicFor } from "@/src/plan/plan";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COUNTRIES = countryOptions();
const NAMED_REGIONS = REGIONS.filter((r) => r.kind === "region");

interface SetupPanelProps {
  draft: PlanDraft;
  plan: Plan;
  topicId: string;
  showOutlines: boolean;
  drawing: boolean;
  onTopic: (topicId: string) => void;
  onVariables: (keys: string[]) => void;
  onDerived: (keys: string[]) => void;
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
    <fieldset className="rail-month">
      <legend className="rail-label">{label} month</legend>
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

function VariableRow({ v, group, checked, disabled, onToggle }: { v: CatalogVariable; group: string; checked: boolean; disabled: boolean; onToggle: () => void }) {
  const c = collectionOf(v);
  const metaId = `meta-${group}-${v.key}`;
  return (
    <label className="ws-var" title={v.description.en}>
      <input type="checkbox" checked={checked} disabled={disabled && !checked} onChange={onToggle} aria-describedby={metaId} />
      <span>
        {v.name.en} <code className="ws-code">{v.dapName.replace(/^.*\//, "")}</code>
        <span className="meta" id={metaId}>
          {v.display.units} · {c.shortName} v{c.version} · {c.temporal.start}→{c.temporal.end ?? "now"}
          {v.domain === "land" ? " · land only" : ""}
        </span>
      </span>
    </label>
  );
}

function DerivedRow({ metric, group, checked, onToggle }: { metric: DerivedMetric; group: string; checked: boolean; onToggle: () => void }) {
  const metaId = `meta-${group}-${metric.key}`;
  return (
    <label className="ws-var ws-var-derived" title={metric.description.en}>
      <input type="checkbox" checked={checked} onChange={onToggle} aria-describedby={metaId} />
      <span>
        {metric.name.en}
        <span className="meta" id={metaId}>
          Derived · {metric.formula} · {metric.display.units}
        </span>
      </span>
    </label>
  );
}

/**
 * Catalog groups: each variable appears once, under the first topic (in
 * catalog order) that requests it; a topic's derived series are listed with it.
 */
function catalogGroups(): Array<{ id: string; title: string; source: string; variables: string[]; derived: string[] }> {
  const seen = new Set<string>();
  const groups = TOPICS.map((t) => {
    const variables = t.variables.filter((k) => !seen.has(k));
    for (const k of variables) seen.add(k);
    const source = t.collections.map((c) => (c.startsWith("GPM") ? "GPM IMERG" : `MERRA-2 ${c.slice(6)}`)).join(", ");
    return { id: t.id, title: t.title.en, source, variables, derived: t.derived };
  }).filter((g) => g.variables.length > 0 || g.derived.length > 0);
  const rest = VARIABLES.map((v) => v.key).filter((k) => !seen.has(k));
  if (rest.length > 0) groups.push({ id: "other", title: "Other verified variables", source: "", variables: rest, derived: [] });
  return groups;
}
const GROUPS = catalogGroups();

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
            <label className="rail-label" htmlFor={`${id}-${side}`}>
              {side[0]!.toUpperCase() + side.slice(1)} (°)
            </label>
            <input id={`${id}-${side}`} type="number" inputMode="decimal" step="0.01" value={coords[side]} onChange={(e) => setCoords((c) => ({ ...c, [side]: e.target.value }))} />
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="rail-btn" onClick={apply}>
          Apply coordinates
        </button>
        <button type="button" className={drawing ? "rail-btn is-active" : "rail-btn"} aria-pressed={drawing} onClick={onToggleDrawing}>
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
  const topic = TOPICS.find((t) => t.id === topicId);
  const suggestedYears = topicFor(draft.variables)?.suggestedYears ?? 20;

  const groups = useMemo(() => {
    const q = query.trim();
    if (!q) return GROUPS;
    const hits = searchCatalog(q, 24).map((h) => h.variable.key);
    const derived = DERIVED.filter((d) => `${d.name.en} ${d.formula} ${d.name.es}`.toLowerCase().includes(q.toLowerCase())).map((d) => d.key);
    return [{ id: "search", title: `Matches for “${q}”`, source: "", variables: hits, derived }];
  }, [query]);

  const toggle = (key: string) => {
    if (draft.variables.includes(key)) props.onVariables(draft.variables.filter((k) => k !== key));
    else if (draft.variables.length < MAX_VARIABLES) props.onVariables([...draft.variables, key]);
  };

  /** Checking a derived series also selects its inputs; unchecking keeps the inputs. */
  const toggleDerived = (key: string) => {
    if (draft.derived.includes(key)) return props.onDerived(draft.derived.filter((k) => k !== key));
    const metric = getDerived(key);
    if (!metric) return;
    const missing = metric.inputs.filter((k) => !draft.variables.includes(k));
    if (draft.variables.length + missing.length > MAX_VARIABLES) return;
    if (missing.length > 0) props.onVariables([...draft.variables, ...missing]);
    props.onDerived([...draft.derived.filter((k) => getDerived(k)), key]);
  };

  const periodChecks = plan.checks.filter((c) => /complete (calendar )?years|Period comparison/.test(c.text));
  const archiveEnd = draft.variables.some((k) => getVariable(k) && collectionOf(getVariable(k)!).temporal.end) ? fmtMonth(coverage.end) : "ongoing";

  return (
    <section className="ws-area-setup" aria-labelledby={`${id}-title`} data-testid="setup">
      <div className="rail-head">
        <p className="ws-step">
          <span className="ws-step-num">01 / </span>Investigate
        </p>
        <h2 className="rail-title" id={`${id}-title`}>
          Investigation setup
        </h2>
      </div>

      <label className="rail-case" htmlFor={`${id}-case`}>
        Investigation case
        <select id={`${id}-case`} value={topicId} onChange={(e) => props.onTopic(e.target.value)}>
          <option value="">Custom selection</option>
          <optgroup label="Original 22-topic catalog (MERRA-2)">
            {TOPICS.filter((t) => t.origin === "original").map((t) => (
              <option key={t.id} value={t.id}>
                {t.title.en}
              </option>
            ))}
          </optgroup>
          <optgroup label="More verified topics">
            {TOPICS.filter((t) => t.origin === "extension").map((t) => (
              <option key={t.id} value={t.id}>
                {t.title.en}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {topic && <p className="rail-question">{topic.question.en}</p>}

      <fieldset className="rail-group">
        <legend id={`${id}-vars`}>
          Variables ({draft.variables.length}/{MAX_VARIABLES})
        </legend>
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
            {draft.derived.map((key) => {
              const metric = getDerived(key);
              if (!metric) return null;
              return (
                <li key={key} className="ws-tag ws-tag-derived" title={metric.description.en}>
                  {metric.formula}
                  <button type="button" aria-label={`Remove derived series ${metric.name.en}`} onClick={() => toggleDerived(key)}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <label className="rail-label" htmlFor={`${id}-search`}>
          Browse or search the catalog
        </label>
        <input id={`${id}-search`} type="search" placeholder="e.g. temperature, lluvia, wind" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="ws-catalog" role="group" aria-label="Catalog variables by topic">
          {groups.map((g) => (
            <details key={g.id} open={Boolean(query.trim()) || g.variables.some((k) => draft.variables.includes(k)) || g.derived.some((k) => draft.derived.includes(k))}>
              <summary>
                {g.title}
                {g.source && <span className="ws-source">· {g.source}</span>}
              </summary>
              {g.variables
                .map((k) => getVariable(k))
                .filter((v): v is CatalogVariable => Boolean(v))
                .map((v) => (
                  <VariableRow key={v.key} v={v} group={g.id} checked={draft.variables.includes(v.key)} disabled={draft.variables.length >= MAX_VARIABLES} onToggle={() => toggle(v.key)} />
                ))}
              {g.derived
                .map((k) => getDerived(k))
                .filter((m): m is DerivedMetric => Boolean(m))
                .map((m) => (
                  <DerivedRow key={m.key} metric={m} group={g.id} checked={draft.derived.includes(m.key)} onToggle={() => toggleDerived(m.key)} />
                ))}
            </details>
          ))}
          {groups[0]?.variables.length === 0 && groups[0]?.derived.length === 0 && (
            <p className="ws-hint" style={{ padding: 10 }}>
              No variable matches. Try a single word.
            </p>
          )}
        </div>
        <p className="ws-hint">
          {VARIABLES.length} live-verified variables and {DERIVED.length} derived series from NASA MERRA-2 and GPM IMERG.
        </p>
      </fieldset>

      <fieldset className="rail-group">
        <legend>Trend period</legend>
        <MonthYear id={`${id}-start`} label="Start" value={draft.start} minYear={Number(coverage.start.slice(0, 4))} maxYear={thisYear} onChange={(v) => props.onPeriod(v, draft.end)} />
        <MonthYear id={`${id}-end`} label="End" value={draft.end} minYear={Number(coverage.start.slice(0, 4))} maxYear={thisYear} onChange={(v) => props.onPeriod(draft.start, v)} />
        <p className="ws-archive">
          Archive: {fmtMonth(coverage.start)}–{archiveEnd}
        </p>
        <button type="button" className="rail-btn" onClick={props.onSuggestedPeriod} data-testid="suggested-period">
          Use suggested {suggestedYears} years
        </button>
        {periodChecks.map((c) => (
          <p key={c.text} className={c.level === "warn" ? "rail-note rail-note-warn" : "rail-note"} role={c.level === "warn" ? "status" : undefined}>
            <span aria-hidden="true">{c.level === "warn" ? "⚠ " : "✓ "}</span>
            {c.text}
          </p>
        ))}
      </fieldset>

      <fieldset className="rail-group">
        <legend>Location</legend>
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
            <label className="rail-label" htmlFor={`${id}-country`}>
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
          <CustomArea
            key={draft.location.customBBox ? JSON.stringify(draft.location.customBBox) : "empty"}
            bbox={draft.location.customBBox}
            drawing={drawing}
            onApply={(bbox) => props.onLocation({ mode: "custom", regionId: draft.location.regionId, customBBox: bbox })}
            onToggleDrawing={props.onToggleDrawing}
          />
        )}
      </fieldset>

      <label className="rail-check">
        <input type="checkbox" checked={showOutlines} onChange={(e) => props.onToggleOutlines(e.target.checked)} />
        Country outlines
      </label>
      <div className="rail-key" aria-hidden="true">
        <span>
          <i className="key-selected" /> Selected location
        </span>
        <span>
          <i className="key-sample" /> Sample location
        </span>
      </div>
    </section>
  );
}
