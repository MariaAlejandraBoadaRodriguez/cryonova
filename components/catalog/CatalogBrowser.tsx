"use client";

/**
 * The catalog page body: every variable and derived series by data source,
 * with a text search, a source filter and each connector's live status
 * (fetched after the page renders, so slow probes never delay the catalog).
 * "Add to investigation" posts the variable to the workspace open in another
 * tab of this browser (src/lib/catalog-bridge.ts).
 */
import { type ReactNode, useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { type CatalogGroup, catalogGroups, catalogSources, countEntries, type DerivedEntry, type EntryFacts, filterCatalog, SOURCE_LABELS, type VariableEntry } from "@/src/catalog/browse";
import { postAddVariable } from "@/src/lib/catalog-bridge";
import type { ConnectorState, ConnectorStatus } from "@/src/providers/status";
import styles from "./catalog.module.css";

const GROUPS = catalogGroups();
const SOURCES = catalogSources(GROUPS);
const TOTAL = countEntries(GROUPS);
const TOTAL_ENTRIES = TOTAL.variables + TOTAL.derived;

const STATE_LABEL: Record<ConnectorState, string> = {
  verified_live: "Verified live",
  reachable: "Reachable",
  configured: "Configured, not integrated",
  pending: "Pending",
  error: "Error",
};

type StatusState = { kind: "loading" } | { kind: "ready"; byId: Record<string, ConnectorStatus>; checkedAt: string | null } | { kind: "failed" };

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function StatusBadge({ status, source }: { status: StatusState; source: string }) {
  if (status.kind === "loading") return <span className="badge badge-neutral">Checking…</span>;
  if (status.kind === "failed") return <span className="badge badge-neutral">Status unavailable</span>;
  const connector = status.byId[source];
  if (!connector) return <span className="badge badge-neutral">Not reported</span>;
  return <span className={connector.state === "verified_live" ? "badge badge-strong" : "badge badge-neutral"}>{STATE_LABEL[connector.state]}</span>;
}

function Facts({ facts, status, source, children }: { facts: EntryFacts; status: StatusState; source: string; children?: ReactNode }) {
  return (
    <dl className={styles.facts}>
      {children}
      <div className={styles.wide}>
        <dt>Product</dt>
        <dd>
          {facts.product} <span className={styles.soft}>· {facts.productTitle}</span>
        </dd>
      </div>
      <div>
        <dt>Resolution</dt>
        <dd>{facts.resolution}</dd>
      </div>
      <div>
        <dt>Frequency</dt>
        <dd>{facts.frequency}</dd>
      </div>
      <div>
        <dt>Coverage</dt>
        <dd>{facts.coverage}</dd>
      </div>
      <div>
        <dt>Geometry</dt>
        <dd>{facts.geometry === "stations" ? "Points (weather stations)" : "Grid"}</dd>
      </div>
      <div>
        <dt>Area</dt>
        <dd>{facts.area}</dd>
      </div>
      <div>
        <dt>Connector status</dt>
        <dd>
          <StatusBadge status={status} source={source} />
        </dd>
      </div>
      <div className={styles.wide}>
        <dt>Access</dt>
        <dd>{facts.access}</dd>
      </div>
    </dl>
  );
}

function addedText(times: number | undefined, what: string): string {
  if (!times) return "";
  return times > 1 ? `${what} to your investigation again` : `${what} to your investigation`;
}

function VariableItem({ entry, group, status, times, onAdd }: { entry: VariableEntry; group: CatalogGroup; status: StatusState; times: number | undefined; onAdd: () => void }) {
  const headingId = `entry-${entry.key}`;
  return (
    <li className={styles.entry} data-testid={`catalog-entry-${entry.key}`} aria-labelledby={headingId}>
      <div className={styles.entryHead}>
        <h3 id={headingId}>{entry.name}</h3>
        <code className={styles.code}>{entry.code}</code>
      </div>
      <p className={styles.description}>{entry.description}</p>
      <p className={styles.aggregation}>{entry.aggregation}</p>
      <Facts facts={entry.facts} status={status} source={group.source}>
        <div className={styles.wide}>
          <dt>Code</dt>
          <dd>
            <code className={styles.code}>{entry.code}</code>
            {entry.requestName ? (
              <>
                {" "}
                requested as <code className={styles.code}>{entry.requestName}</code>
              </>
            ) : null}
            <span className={styles.soft}> · provider name “{entry.providerName}”</span>
          </dd>
        </div>
        <div className={styles.wide}>
          <dt>Units</dt>
          <dd>
            {entry.displayUnits} <span className={styles.soft}>(provider units: {entry.providerUnits})</span>
          </dd>
        </div>
      </Facts>
      <div className={styles.actions}>
        <button type="button" className="btn btn-primary btn-small" onClick={onAdd} aria-label={`Add to investigation: ${entry.name}`} data-testid={`catalog-add-${entry.key}`}>
          Add to investigation
        </button>
        <p className={styles.added} role="status" data-testid={`catalog-added-${entry.key}`}>
          {addedText(times, "Added")}
        </p>
      </div>
    </li>
  );
}

function DerivedItem({ entry, group, status, times, onAdd }: { entry: DerivedEntry; group: CatalogGroup; status: StatusState; times: number | undefined; onAdd: () => void }) {
  const headingId = `entry-${entry.key}`;
  const codes = entry.inputs.map((i) => i.code);
  const list = codes.length > 1 ? `${codes.slice(0, -1).join(", ")} and ${codes.at(-1)}` : (codes[0] ?? "");
  return (
    <li className={`${styles.entry} ${styles.derived}`} data-testid={`catalog-entry-${entry.key}`} aria-labelledby={headingId}>
      <div className={styles.entryHead}>
        <h3 id={headingId}>{entry.name}</h3>
        <code className={styles.code}>{entry.formula}</code>
      </div>
      <p className={styles.description}>{entry.description}</p>
      <p className={styles.aggregation}>Derived series: computed each month from the regional means of its inputs, so it needs no extra provider request.</p>
      <Facts facts={entry.facts} status={status} source={group.source}>
        <div className={styles.wide}>
          <dt>Formula</dt>
          <dd>
            <code className={styles.code}>{entry.formula}</code>
          </dd>
        </div>
        <div className={styles.wide}>
          <dt>Units</dt>
          <dd>
            {entry.displayUnits} <span className={styles.soft}>(the inputs’ display units)</span>
          </dd>
        </div>
      </Facts>
      <div className={styles.needs}>
        <p className={styles.needsTitle}>Needs these variables</p>
        <ul className={styles.inputs} data-testid={`catalog-inputs-${entry.key}`}>
          {entry.inputs.map((i) => (
            <li key={i.key}>
              <code className={styles.code}>{i.code}</code> {i.name}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.actions}>
        <button type="button" className="btn btn-secondary btn-small" onClick={onAdd} aria-label={`Add inputs: ${list}, for ${entry.name}`} data-testid={`catalog-add-inputs-${entry.key}`}>
          Add inputs
        </button>
        <p className={styles.added} role="status" data-testid={`catalog-added-${entry.key}`}>
          {addedText(times, `Added ${list}`)}
        </p>
      </div>
    </li>
  );
}

function GroupStatus({ status, group }: { status: StatusState; group: CatalogGroup }) {
  const connector = status.kind === "ready" ? status.byId[group.source] : undefined;
  let detail = "Checking the connector…";
  if (status.kind === "failed") detail = "The live status could not be loaded; the catalog itself is unaffected.";
  else if (status.kind === "ready") detail = connector ? `${connector.detail}${connector.latestData ? ` Latest data: ${connector.latestData}.` : ""}` : "This connector was not in the status report.";
  return (
    <p className={styles.groupStatus} data-testid={`catalog-group-status-${group.id}`}>
      <span>
        {SOURCE_LABELS[group.source]} connector: <StatusBadge status={status} source={group.source} />
      </span>
      <span>{detail}</span>
    </p>
  );
}

export function CatalogBrowser() {
  const searchId = useId();
  const sourceId = useId();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<StatusState>({ kind: "loading" });
  const [added, setAdded] = useState<Record<string, number>>({});
  const deferredQuery = useDeferredValue(query);

  const visible = useMemo(() => filterCatalog(GROUPS, { query: deferredQuery, source }), [deferredQuery, source]);
  const shown = countEntries(visible);
  const filtered = Boolean(deferredQuery.trim()) || Boolean(source);

  // Live connector status, fetched after the first render (probes can take seconds on a cold cache).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/connectors/status", { cache: "no-store", signal: AbortSignal.timeout(45_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = (await response.json()) as { connectors?: ConnectorStatus[] };
        const connectors = body.connectors ?? [];
        if (!cancelled) setStatus({ kind: "ready", byId: Object.fromEntries(connectors.map((c) => [c.id, c])), checkedAt: connectors[0]?.checkedAt ?? null });
      } catch {
        if (!cancelled) setStatus({ kind: "failed" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Posts each key to the open workspace and records the feedback for the entry and the keys. */
  const add = (entryKey: string, keys: string[]) => {
    for (const key of keys) postAddVariable(key);
    setAdded((previous) => {
      const next = { ...previous };
      for (const key of new Set([entryKey, ...keys])) next[key] = (next[key] ?? 0) + 1;
      return next;
    });
  };

  const reset = () => {
    setQuery("");
    setSource("");
  };

  let summary = `${plural(TOTAL_ENTRIES, "entry", "entries")}: ${plural(TOTAL.variables, "variable", "variables")} and ${plural(TOTAL.derived, "derived series", "derived series")}.`;
  if (filtered) summary = `${plural(shown.variables + shown.derived, "entry matches", "entries match")} of ${TOTAL_ENTRIES}: ${plural(shown.variables, "variable", "variables")} and ${plural(shown.derived, "derived series", "derived series")}.`;

  let connectorLine = "Checking each connector’s live status…";
  if (status.kind === "failed") connectorLine = "The connectors’ live status could not be loaded right now.";
  else if (status.kind === "ready") connectorLine = `Connector status checked${status.checkedAt ? ` at ${status.checkedAt.replace("T", " ").slice(0, 16)} UTC` : ""} (cached for up to 5 minutes).`;

  return (
    <div data-testid="catalog">
      <form role="search" aria-label="Catalog" className={styles.controls} onSubmit={(e) => e.preventDefault()}>
        <div>
          <label htmlFor={searchId}>Search variables</label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${searchId}-help`}
            data-testid="catalog-search"
          />
          <p id={`${searchId}-help`} className="field-help">
            Name, code or description, for example “soil moisture”, “T2M” or “rain”.
          </p>
        </div>
        <div>
          <label htmlFor={sourceId}>Source</label>
          <select id={sourceId} value={source} onChange={(e) => setSource(e.target.value)} data-testid="catalog-source">
            <option value="">All sources ({TOTAL_ENTRIES})</option>
            {SOURCES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} ({s.count})
              </option>
            ))}
          </select>
        </div>
      </form>

      <div className={styles.summary}>
        <p role="status" data-testid="catalog-count">
          {summary}
        </p>
        <p aria-live="polite" className={styles.soft} data-testid="catalog-connectors">
          {connectorLine}
        </p>
      </div>

      {visible.length > 0 ? (
        <nav aria-label="Catalog sections" className={styles.jump} data-testid="catalog-jump">
          <ul>
            {visible.map((g) => (
              <li key={g.id}>
                <a href={`#group-${g.id}`}>
                  {g.label} <span className={styles.soft}>({g.entries.length})</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <div className={styles.empty} data-testid="catalog-empty">
          <p>
            Nothing in the catalog matches{deferredQuery.trim() ? ` “${deferredQuery.trim()}”` : ""}
            {source ? ` in ${SOURCE_LABELS[source as keyof typeof SOURCE_LABELS] ?? source}` : ""}. Try another word or another source.
          </p>
          <button type="button" className="btn btn-secondary btn-small" onClick={reset} data-testid="catalog-reset">
            Show the whole catalog
          </button>
        </div>
      )}

      {visible.map((g) => (
        <section key={g.id} className={styles.group} aria-labelledby={`group-${g.id}`} data-testid={`catalog-group-${g.id}`}>
          <div className={styles.groupHead}>
            <h2 id={`group-${g.id}`} tabIndex={-1}>
              {g.label} <span className={styles.groupTitle}>· {g.title}</span>
            </h2>
            <p className={styles.groupMeta}>
              {g.facts.product} · {g.facts.resolution} · monthly · {g.facts.coverage} · {g.facts.geometry === "stations" ? "points (weather stations)" : "grid"}
            </p>
            <GroupStatus status={status} group={g} />
          </div>
          <ul className={styles.entries}>
            {g.entries.map((e) =>
              e.kind === "variable" ? (
                <VariableItem key={e.key} entry={e} group={g} status={status} times={added[e.key]} onAdd={() => add(e.key, [e.key])} />
              ) : (
                <DerivedItem key={e.key} entry={e} group={g} status={status} times={added[e.key]} onAdd={() => add(e.key, e.inputs.map((i) => i.key))} />
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
