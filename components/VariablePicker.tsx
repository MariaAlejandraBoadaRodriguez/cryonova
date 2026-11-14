"use client";

/**
 * Catalog search and multi-selection. Search accepts single words or phrases in
 * English or Spanish; each selection appears as a removable tag.
 */
import { useId, useMemo, useState } from "react";
import { collectionOf, getVariable, TOPICS, VARIABLES } from "@/src/catalog";
import { searchCatalog } from "@/src/catalog/search";
import type { CatalogVariable } from "@/src/catalog/types";
import { MAX_VARIABLES } from "@/src/jobs/selection";

function coverageLabel(v: CatalogVariable): string {
  const c = collectionOf(v).temporal;
  return `${c.start} → ${c.end ?? "ongoing"}`;
}

export function VariablePicker({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("");

  const results = useMemo(() => {
    if (query.trim()) return searchCatalog(query, 12).map((h) => h.variable);
    if (topic) {
      const t = TOPICS.find((x) => x.id === topic);
      return (t?.variables ?? []).map((k) => getVariable(k)).filter((v): v is CatalogVariable => Boolean(v));
    }
    return VARIABLES.filter((v) => ["merra2.T2M", "merra2.PRECTOTCORR", "imerg.precipitation", "merra2.QV2M", "merra2.GWETTOP", "merra2.TOTEXTTAU"].includes(v.key));
  }, [query, topic]);

  const DISCOVERY_SET = ["merra2.T2M", "merra2.TS", "merra2.QV2M", "merra2.TQV", "merra2.SLP", "merra2.PRECTOTCORR", "merra2.EVAP", "merra2.GWETTOP", "merra2.SWGDN", "merra2.CLDTOT"];

  const toggle = (key: string) => {
    if (selected.includes(key)) onChange(selected.filter((k) => k !== key));
    else if (selected.length < MAX_VARIABLES) onChange([...selected, key]);
  };

  return (
    <div className="stack">
      <div>
        <span className="label" id={`${id}-tags`}>
          Selected variables ({selected.length}/{MAX_VARIABLES})
        </span>
        {selected.length === 0 ? (
          <p className="field-help">None yet. Search or browse a topic below.</p>
        ) : (
          <ul className="tags" aria-labelledby={`${id}-tags`}>
            {selected.map((key) => {
              const v = getVariable(key);
              return (
                <li key={key} className="tag">
                  <span>
                    {v?.name.en ?? key} <span className="mono muted">{v?.display.units}</span>
                  </span>
                  <button type="button" aria-label={`Remove ${v?.name.en ?? key}`} onClick={() => toggle(key)}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="row">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => onChange([...new Set([...selected, ...DISCOVERY_SET])].slice(0, MAX_VARIABLES))} data-testid="discovery-set">
          Add a discovery set (10 variables, 4 products)
        </button>
        <span className="field-help">For “which variables changed?” searches; results are ranked with multiple-comparison correction.</span>
      </div>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: "2 1 220px" }}>
          <label htmlFor={`${id}-q`}>Search the catalog</label>
          <input
            id={`${id}-q`}
            type="search"
            placeholder="e.g. air temperature, lluvia, soil moisture, ozono"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setTopic("");
            }}
          />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label htmlFor={`${id}-topic`}>Or browse a topic</label>
          <select
            id={`${id}-topic`}
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              setQuery("");
            }}
          >
            <option value="">Suggested variables</option>
            {TOPICS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title.en}
              </option>
            ))}
          </select>
        </div>
      </div>
      {topic && <p className="field-help">{TOPICS.find((t) => t.id === topic)?.question.en}</p>}

      {results.length === 0 ? (
        <p className="alert alert-info">No catalog variable matches “{query}”. Try a single word such as “rain” or “temperatura”.</p>
      ) : (
        <ul className="option-list" aria-label="Catalog results">
          {results.map((v) => {
            const c = collectionOf(v);
            const isOn = selected.includes(v.key);
            return (
              <li key={v.key} className="variable-option">
                <div>
                  <strong>{v.name.en}</strong>
                  <div className="meta">{v.description.en}</div>
                  <div className="meta mono">
                    {c.shortName} v{c.version} · {v.dapName.replace(/^.*\//, "")} · {v.display.units} · {c.grid.resolutionLabel} · monthly · {coverageLabel(v)} ·{" "}
                    {v.domain === "land" ? "land only" : "global"}
                  </div>
                </div>
                <button
                  type="button"
                  className={isOn ? "btn btn-primary btn-small" : "btn btn-secondary btn-small"}
                  aria-pressed={isOn}
                  aria-label={`${isOn ? "Remove" : "Add"} ${v.name.en}`}
                  disabled={!isOn && selected.length >= MAX_VARIABLES}
                  onClick={() => toggle(v.key)}
                >
                  {isOn ? "Added" : "Add"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
