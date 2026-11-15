"use client";

/**
 * Left column: investigation setup (case, variables, period, location).
 * Nothing here is automatic: a variable is added only when the user picks it
 * (a search suggestion, a case, the catalog page), every tag is removable, and
 * the period changes only through its selects or the suggestion button.
 * Exactly one location mode is active; the globe and these fields edit the
 * same draft, so everything here is a keyboard path for the map actions.
 */
import Link from "next/link";
import { type KeyboardEvent, useId, useMemo, useState } from "react";
import { collectionOf, getVariable, TOPICS, VARIABLES } from "@/src/catalog";
import { type BBox, countryOptions, REGIONS } from "@/src/catalog/regions";
import { DERIVED, getDerived } from "@/src/catalog/derived";
import { searchCatalog } from "@/src/catalog/search";
import type { CatalogVariable } from "@/src/catalog/types";
import { MAX_VARIABLES } from "@/src/jobs/selection";
import { fmtMonth } from "@/src/lib/format";
import { validateBBox } from "@/src/providers/grid";
import { type LocationState, periodYearRange, type Plan, type PlanDraft, sharedCoverage, topicFor } from "@/src/plan/plan";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const COUNTRIES = countryOptions();
const NAMED_REGIONS = REGIONS.filter((r) => r.kind === "region");
const MAX_SUGGESTIONS = 8;

interface SetupPanelProps {
  draft: PlanDraft;
  plan: Plan;
  topicId: string;
  showOutlines: boolean;
  drawing: boolean;
  /** Variables, period and location are all set: the summary can be reviewed. */
  canReview: boolean;
  /** Short confirmation after a variable is added (search or catalog page), announced politely. */
  notice: string | null;
  onTopic: (topicId: string) => void;
  onVariables: (keys: string[]) => void;
  onAddVariable: (key: string) => void;
  onDerived: (keys: string[]) => void;
  onPeriod: (start: string, end: string) => void;
  onSuggestedPeriod: () => void;
  onLocation: (location: LocationState) => void;
  onToggleOutlines: (value: boolean) => void;
  onToggleDrawing: () => void;
  onReviewSummary: () => void;
}

function MonthYear({ id, label, value, minYear, maxYear, onChange }: { id: string; label: string; value: string; minYear: number; maxYear: number; onChange: (v: string) => void }) {
  const [year, month] = value.split("-");
  const years = Array.from({ length: Math.max(0, maxYear - minYear + 1) }, (_, i) => String(maxYear - i));
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

/** "MERRA-2 M2TMNXSLV · K → °C · 1980-01 → now", the short provenance shown under a suggestion. */
function variableMeta(v: CatalogVariable): string {
  const c = collectionOf(v);
  return `${v.display.units} · ${c.shortName} · ${c.temporal.start} → ${c.temporal.end ?? "now"}${v.domain === "land" ? " · land only" : v.domain === "ocean" ? " · ocean only" : ""}`;
}

/**
 * Search box with suggestions (WAI-ARIA combobox with a listbox popup).
 * Typing shows matching variables; choosing one (click, or arrows + Enter)
 * adds exactly that variable. Escape closes the list, then clears the text.
 */
function VariableSearch({ selected, onAdd }: { selected: string[]; onAdd: (key: string) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const hits = useMemo(() => (query.trim() ? searchCatalog(query, MAX_SUGGESTIONS).map((h) => h.variable) : []), [query]);
  const full = selected.length >= MAX_VARIABLES;
  const expanded = open && query.trim().length > 0 && hits.length > 0;
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;

  const choose = (v: CatalogVariable) => {
    if (selected.includes(v.key) || full) return;
    onAdd(v.key);
    setQuery("");
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      const hit = expanded && active >= 0 ? hits[active] : undefined;
      if (hit) {
        e.preventDefault();
        choose(hit);
      }
    } else if (e.key === "Escape") {
      if (expanded) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query) {
        e.preventDefault();
        setQuery("");
      }
    }
  };

  return (
    <div className="ws-search">
      <label className="rail-label" htmlFor={`${id}-input`}>
        Search variables
      </label>
      <input
        id={`${id}-input`}
        type="search"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder="e.g. temperature, rain, wind"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        aria-describedby={`${id}-help`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        data-testid="variable-search"
      />
      <ul className="ws-suggest" id={listId} role="listbox" aria-label="Matching variables" hidden={!expanded}>
        {hits.map((v, i) => {
          const chosen = selected.includes(v.key);
          const disabled = chosen || full;
          return (
            <li
              key={v.key}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              aria-disabled={disabled || undefined}
              className={["ws-suggest-option", i === active ? "is-active" : "", disabled ? "is-disabled" : ""].filter(Boolean).join(" ")}
              // Keep focus in the input so the list stays open until the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(v)}
              data-testid={`variable-option-${v.key}`}
            >
              <span className="ws-suggest-name">
                {v.name.en} <code className="ws-code">{v.dapName.replace(/^.*\//, "")}</code>
                {chosen && <span className="ws-suggest-state"> · selected</span>}
              </span>
              <span className="ws-suggest-meta">{variableMeta(v)}</span>
            </li>
          );
        })}
      </ul>
      <p className="ws-hint" id={`${id}-help`} aria-live="polite">
        {query.trim() && hits.length === 0
          ? `No variable matches “${query.trim()}”. Try a single word, or browse all variables.`
          : full
            ? `The maximum of ${MAX_VARIABLES} variables is selected; remove one to add another.`
            : "Choosing a suggestion adds exactly that variable."}
      </p>
    </div>
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
  const coverage = sharedCoverage(draft.variables);
  const years = periodYearRange(draft.variables, draft.start, draft.end);
  const topic = TOPICS.find((t) => t.id === topicId);
  const suggestedYears = topicFor(draft.variables)?.suggestedYears ?? 20;

  const remove = (key: string) => props.onVariables(draft.variables.filter((k) => k !== key));

  // Period notes are warnings only; the hard rules (end before start, under 12 months) also disable Start analysis.
  const periodNotes = [
    ...plan.blockers.filter((b) => /end month must not|at least 12 months/.test(b)).map((text) => ({ level: "warn" as const, text })),
    ...plan.checks.filter((c) => /complete (calendar )?years|Period comparison|archive coverage of the selected/.test(c.text)),
  ];
  const archiveEnd = draft.variables.some((k) => getVariable(k) && collectionOf(getVariable(k)!).temporal.end) ? fmtMonth(coverage.end) : "ongoing";
  const missing = [draft.variables.length === 0 ? "a variable" : null, plan.period.months === 0 ? "a valid period" : null, plan.location ? null : "a location"].filter(Boolean);

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
          <p className="ws-hint">None selected. Search below, pick a case above, or browse all variables.</p>
        ) : (
          <ul className="ws-tags" aria-labelledby={`${id}-vars`}>
            {draft.variables.map((key) => {
              const v = getVariable(key);
              return (
                <li key={key} className="ws-tag" title={v ? `${v.display.units} · ${collectionOf(v).shortName}` : key} data-testid={`variable-tag-${key}`}>
                  {v?.name.en ?? key}
                  <button type="button" aria-label={`Remove ${v?.name.en ?? key}`} onClick={() => remove(key)}>
                    ×
                  </button>
                </li>
              );
            })}
            {draft.derived.map((key) => {
              const metric = getDerived(key);
              if (!metric) return null;
              return (
                <li key={key} className="ws-tag ws-tag-derived" title={metric.description.en} data-testid={`derived-tag-${key}`}>
                  {metric.formula}
                  <button type="button" aria-label={`Remove derived series ${metric.name.en}`} onClick={() => props.onDerived(draft.derived.filter((k) => k !== key))}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="visually-hidden" role="status">
          {props.notice ?? ""}
        </p>
        <VariableSearch selected={draft.variables} onAdd={props.onAddVariable} />
        <Link className="rail-btn rail-link" href="/catalog" target="_blank" rel="noopener" prefetch={false} data-testid="browse-catalog">
          Browse all variables<span className="visually-hidden"> (opens the catalog in a new tab)</span>
          <span aria-hidden="true"> ↗</span>
        </Link>
        <p className="ws-hint">
          {VARIABLES.length} live-verified variables and {DERIVED.length} derived series. Variables added in the catalog tab appear here.
        </p>
      </fieldset>

      <fieldset className="rail-group">
        <legend>Trend period</legend>
        <MonthYear id={`${id}-start`} label="Start" value={draft.start} minYear={years.min} maxYear={years.max} onChange={(v) => props.onPeriod(v, draft.end)} />
        <MonthYear id={`${id}-end`} label="End" value={draft.end} minYear={years.min} maxYear={years.max} onChange={(v) => props.onPeriod(draft.start, v)} />
        <p className="ws-archive">
          Archive: {fmtMonth(coverage.start)}–{archiveEnd}
        </p>
        <button type="button" className="rail-btn" onClick={props.onSuggestedPeriod} data-testid="suggested-period">
          Use suggested {suggestedYears} years
        </button>
        {periodNotes.map((c) => (
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

      <div className="rail-review">
        {props.canReview ? (
          <>
            <button type="button" className="ws-btn ws-btn-neon rail-review-btn" onClick={props.onReviewSummary} data-testid="review-summary">
              Review summary
            </button>
            <p className="ws-hint">The question is optional; a working title is generated from your selection.</p>
          </>
        ) : (
          <p className="ws-hint" data-testid="review-summary-hint">
            To review the summary, choose {missing.join(", ")}.
          </p>
        )}
      </div>
    </section>
  );
}
