/**
 * Durable run executor.
 *
 * A run is executed by whichever invocation holds its lease. Work is split into
 * provider reads (collection x month) persisted as rows, so an invocation that
 * runs out of time, crashes or is cancelled leaves a consistent state; the next
 * invocation (triggered by any status poll) continues with the pending rows.
 */
import { randomUUID } from "node:crypto";
import { analyzeVariable } from "@/src/analytics/analyze";
import { monthsBetween, type MonthlyPoint } from "@/src/analytics/series";
import { collectionOf, getCollection, getVariable } from "@/src/catalog";
import { crossesAntimeridian } from "@/src/catalog/regions";
import type { CatalogVariable } from "@/src/catalog/types";
import type { RunStore } from "@/src/db/store";
import { ProviderError } from "@/src/lib/http";
import { config } from "@/src/lib/env";
import { errorMessage, type Logger, logger as rootLogger } from "@/src/lib/log";
import { findGranules } from "@/src/providers/cmr";
import { planWindow, readGranule } from "@/src/providers/gridded";
import { POLICIES, withSignal } from "@/src/providers/policies";
import { groupByCollection, type Selection, SelectionSchema } from "./selection";
import type { RunProgress, RunResult, RunRow, SampleRow, SourceProvenance, VariableResult } from "./types";

export interface RunnerDeps {
  store: RunStore;
  earthdataToken?: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
  concurrency?: number;
  /** Wall-clock budget for one invocation; leftover work is resumed later. */
  budgetMs?: number;
  leaseMs?: number;
  flushEvery?: number;
  logger?: Logger;
}

const DEFAULT_BUDGET_MS = 240_000;
const DEFAULT_LEASE_MS = 60_000;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

function safeUrl(url: string): string {
  return url.replace(/([?&](?:token|access_token)=)[^&]+/gi, "$1[redacted]");
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>, shouldStop: () => boolean): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length && !shouldStop()) {
      const item = items[next] as T;
      next += 1;
      await worker(item);
    }
  });
  await Promise.all(lanes);
}

export async function executeRun(runId: string, deps: RunnerDeps): Promise<RunRow | null> {
  const { store } = deps;
  const log = (deps.logger ?? rootLogger).child({ runId });
  const owner = randomUUID();
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS;
  const invocationStart = Date.now();
  const deadline = invocationStart + (deps.budgetMs ?? DEFAULT_BUDGET_MS);
  const concurrency = deps.concurrency ?? config.providerConcurrency;

  const run = await store.acquireLease(runId, owner, leaseMs);
  if (!run) return null;
  const progress: RunProgress = { ...run.progress, invocations: (run.progress.invocations ?? 0) + 1 };
  const timings = { ...(progress.timings ?? {}) };
  log.info("run.invocation.start", { attempt: run.attempts, phase: progress.phase });

  const fail = async (kind: string, message: string, host?: string) => {
    progress.phase = "done";
    progress.message = message;
    await store.finishRun(runId, owner, { status: "failed", progress, error: { kind, message, host } });
    log.error("run.failed", { kind, message, host });
    return store.getRun(runId);
  };

  const parsed = SelectionSchema.safeParse(run.selection);
  if (!parsed.success) return fail("invalid_selection", parsed.error.issues.map((i) => i.message).join("; "));
  const selection = parsed.data;
  const token = deps.earthdataToken ?? config.earthdataToken;
  if (!token) return fail("configuration", "The NASA Earthdata token is not configured on the server. An administrator must set EARTHDATA_TOKEN.");

  const months = monthsBetween(selection.start, selection.end);
  const groups = groupByCollection(selection);
  const controller = new AbortController();

  try {
    // Phase 1: discovery. Planned rows make later phases idempotent.
    if (progress.phase === "queued" || progress.phase === "discovering") {
      progress.phase = "discovering";
      const started = Date.now();
      for (const collectionName of groups.keys()) {
        const collection = getCollection(collectionName)!;
        const found = await findGranules(collection.conceptId, selection.start, selection.end, withSignal(POLICIES.cmrSearch, controller.signal), deps.fetchImpl);
        const byMonth = new Map(found.granules.map((g) => [g.month, g]));
        const rows: SampleRow[] = months.map((month) => {
          const granule = byMonth.get(month);
          return {
            runId, collection: collectionName, month, status: granule?.opendapUrl ? "pending" : "missing",
            granuleId: granule?.id ?? null, granuleTitle: granule?.title ?? null, opendapUrl: granule?.opendapUrl ?? null,
            values: null, bytes: null, durationMs: null, attempts: 0,
            error: granule ? (granule.opendapUrl ? null : "Granule has no OPeNDAP service link") : "No granule published for this month",
            fetchedAt: null,
          };
        });
        await store.planSamples(rows);
        log.info("run.discovery", { collection: collectionName, granules: found.granules.length, months: months.length, ms: found.durationMs });
      }
      timings.discoveryMs = (timings.discoveryMs ?? 0) + (Date.now() - started);
      progress.phase = "reading";
    }

    // Phase 2: provider reads with bounded concurrency.
    if (progress.phase === "reading") {
      const pending = await store.listSamples(runId, ["pending"]);
      const all = await store.listSamples(runId);
      progress.tasksTotal = all.length;
      progress.tasksMissing = all.filter((s) => s.status === "missing").length;
      progress.tasksDone = all.filter((s) => s.status === "ok").length;
      progress.tasksFailed = all.filter((s) => s.status === "failed").length;
      progress.bytes = all.reduce((sum, s) => sum + (s.bytes ?? 0), 0);

      const windows = new Map([...groups.keys()].map((name) => [name, planWindow(getCollection(name)!, selection.region.bbox)]));
      const variablesByCollection = new Map([...groups.entries()].map(([name, keys]) => [name, keys.map((k) => getVariable(k)!)]));
      const buffer: SampleRow[] = [];
      let cancelled = false;
      let lastFlush = Date.now();
      const readStart = Date.now();

      const flush = async (force = false) => {
        if (!force && buffer.length < (deps.flushEvery ?? 12) && Date.now() - lastFlush < 2_000) return;
        const batch = buffer.splice(0, buffer.length);
        lastFlush = Date.now();
        if (batch.length > 0) await store.saveSamples(batch);
        const lease = await store.renewLease(runId, owner, leaseMs, { ...progress, timings });
        if (!lease.ok) throw new Error("Lease lost to another invocation");
        if (lease.cancelRequested && !cancelled) {
          cancelled = true;
          controller.abort(new Error("cancelled"));
        }
      };

      await pool(
        pending,
        concurrency,
        async (task) => {
          const collection = getCollection(task.collection)!;
          const started = Date.now();
          try {
            const read = await readGranule(task.opendapUrl!, collection, variablesByCollection.get(task.collection)!, windows.get(task.collection)!, {
              token,
              policy: withSignal(POLICIES.opendapRead, controller.signal),
              fetchImpl: deps.fetchImpl,
            });
            buffer.push({ ...task, status: "ok", values: read.values, bytes: read.bytes, durationMs: read.durationMs, attempts: task.attempts + read.attempts, error: null, fetchedAt: new Date() });
            progress.tasksDone = (progress.tasksDone ?? 0) + 1;
            progress.bytes = (progress.bytes ?? 0) + read.bytes;
          } catch (error) {
            if (error instanceof ProviderError && error.kind === "cancelled") return;
            const message = error instanceof ProviderError ? `${error.kind}: ${error.message}` : errorMessage(error);
            buffer.push({ ...task, status: "failed", values: null, bytes: 0, durationMs: Date.now() - started, attempts: task.attempts + (error instanceof ProviderError ? error.attempts : 1), error: message.slice(0, 400), fetchedAt: new Date() });
            progress.tasksFailed = (progress.tasksFailed ?? 0) + 1;
            log.warn("run.read.failed", { collection: task.collection, month: task.month, error: message.slice(0, 200) });
          }
          await flush();
        },
        () => cancelled || Date.now() > deadline,
      );
      await flush(true);
      timings.readWallMs = (timings.readWallMs ?? 0) + (Date.now() - readStart);

      if (cancelled) {
        progress.phase = "done";
        progress.message = "Cancelled by the user";
        await store.finishRun(runId, owner, { status: "cancelled", progress: { ...progress, timings } });
        log.info("run.cancelled", { done: progress.tasksDone });
        return store.getRun(runId);
      }
      const remaining = await store.listSamples(runId, ["pending"]);
      if (remaining.length > 0) {
        progress.message = `Paused after this invocation's time budget; ${remaining.length} reads remain and will resume automatically.`;
        await store.releaseLease(runId, owner, { ...progress, timings });
        log.info("run.paused", { remaining: remaining.length });
        return store.getRun(runId);
      }
      progress.phase = "analyzing";
    }

    // Phase 3: analysis from the persisted reads only.
    const analysisStart = Date.now();
    const samples = await store.listSamples(runId);
    const result = buildResult(run, selection, samples, { ...timings, analysisStart, invocationStart, concurrency, invocations: progress.invocations ?? 1 });
    progress.phase = "done";
    progress.message = result.status === "failed" ? "No valid values were returned by the provider." : undefined;
    progress.timings = result.timings;
    await store.finishRun(runId, owner, {
      status: result.status,
      progress,
      result,
      error: result.status === "failed" ? { kind: "no_data", message: result.warnings.join(" ") || "No valid data" } : null,
    });
    log.info("run.finished", { status: result.status, totalMs: result.timings.totalMs, reads: progress.tasksDone, failed: progress.tasksFailed });
    return store.getRun(runId);
  } catch (error) {
    if (error instanceof ProviderError) return fail(error.kind, error.message, error.host);
    return fail("internal", errorMessage(error));
  }
}

interface TimingInput {
  discoveryMs?: number;
  readWallMs?: number;
  analysisStart: number;
  invocationStart: number;
  concurrency: number;
  invocations: number;
}

export function buildResult(run: RunRow, selection: Selection, samples: SampleRow[], t: TimingInput): RunResult {
  const months = monthsBetween(selection.start, selection.end);
  const warnings: string[] = [];
  const sources: SourceProvenance[] = [];
  const variables: VariableResult[] = [];

  for (const [collectionName, keys] of groupByCollection(selection)) {
    const collection = getCollection(collectionName)!;
    const rows = samples.filter((s) => s.collection === collectionName);
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const window = planWindow(collection, selection.region.bbox);
    const ok = rows.filter((r) => r.status === "ok");
    const failed = rows.filter((r) => r.status === "failed");
    const missing = rows.filter((r) => r.status === "missing");
    const durations = ok.map((r) => r.durationMs ?? 0).sort((a, b) => a - b);
    const fetched = ok.map((r) => r.fetchedAt).filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime());
    const example = ok[0]?.opendapUrl ?? null;

    if (window.stride > 1) warnings.push(`${collectionName}: the region was subsampled every ${window.stride} cells to bound request size.`);
    if (window.snapped) warnings.push(`${collectionName}: the region is smaller than one grid cell; the nearest cell was used.`);
    if (failed.length > 0) warnings.push(`${collectionName}: ${failed.length} monthly reads failed and are treated as missing.`);
    if (missing.length > 0) warnings.push(`${collectionName}: ${missing.length} requested months have no published granule.`);

    sources.push({
      collection: collectionName,
      conceptId: collection.conceptId,
      version: collection.version,
      title: collection.title,
      provider: collection.provider,
      doi: collection.doi ?? null,
      citation: collection.citation,
      landingPage: collection.landingPage,
      cmrQuery: `https://cmr.earthdata.nasa.gov/search/granules.json?collection_concept_id=${collection.conceptId}&temporal=${selection.start}..${selection.end}`,
      granulesFound: rows.length - missing.length,
      monthsRequested: months.length,
      monthsRead: ok.length,
      monthsFailed: failed.length,
      monthsMissing: missing.length,
      firstGranule: ok[0]?.granuleTitle ?? null,
      lastGranule: ok[ok.length - 1]?.granuleTitle ?? null,
      exampleRequest: example ? safeUrl(`${example}.dods?…`) : null,
      fetchedFrom: fetched[0]?.toISOString() ?? null,
      fetchedTo: fetched[fetched.length - 1]?.toISOString() ?? null,
      bytes: ok.reduce((sum, r) => sum + (r.bytes ?? 0), 0),
      readMs: { median: percentile(durations, 50), p95: percentile(durations, 95), max: durations[durations.length - 1] ?? 0 },
      window: { lat: window.lat, lon: window.lon, cells: window.cells, nativeCells: window.nativeCells, stride: window.stride, snapped: window.snapped, resolution: collection.grid.resolutionLabel },
      access: "NASA Earthdata Cloud OPeNDAP (DAP2 binary), Earthdata Login bearer token held on the server",
    });

    for (const key of keys) {
      const variable = getVariable(key) as CatalogVariable;
      const points: MonthlyPoint[] = months.map((month) => {
        const row = byMonth.get(month);
        const value = row?.status === "ok" ? row.values?.find((v) => v.key === key) : undefined;
        return { month, value: value?.mean ?? null, validCells: value?.validCells ?? 0, totalCells: value?.totalCells ?? 0 };
      });
      const analysis = analyzeVariable({ variable, points, monthsWithGranule: rows.length - missing.length, failedMonths: failed.map((r) => r.month), window });
      if (analysis.coverage.monthsValid === 0) warnings.push(`${key}: no valid values in the selected region (check land/ocean domain and coverage).`);
      const c = collectionOf(variable);
      variables.push({
        key, name: variable.name, source: variable.source, collection: collectionName, product: c.shortName, version: c.version,
        dapName: variable.dapName, providerLongName: variable.providerLongName, domain: variable.domain, unitGroup: variable.display.group,
        aggregation: variable.aggregation, analysis,
      });
    }
  }

  const anyValid = variables.some((v) => v.analysis.coverage.monthsValid > 0);
  const anyGap = sources.some((s) => s.monthsFailed > 0);
  const now = Date.now();
  const readSumMs = samples.reduce((sum, s) => sum + (s.status === "ok" ? (s.durationMs ?? 0) : 0), 0);
  return {
    schemaVersion: 1,
    runId: run.id,
    status: !anyValid ? "failed" : anyGap ? "partial" : "succeeded",
    createdAt: run.createdAt.toISOString(),
    completedAt: new Date(now).toISOString(),
    selection,
    region: { bbox: selection.region.bbox, name: selection.region.name ?? null, crossesAntimeridian: crossesAntimeridian(selection.region.bbox) },
    variables,
    sources,
    timings: {
      queueMs: run.startedAt ? Math.max(0, run.startedAt.getTime() - run.createdAt.getTime()) : 0,
      discoveryMs: t.discoveryMs ?? 0,
      readWallMs: t.readWallMs ?? 0,
      readSumMs,
      analysisMs: now - t.analysisStart,
      totalMs: now - run.createdAt.getTime(),
      invocations: t.invocations,
      concurrency: t.concurrency,
    },
    warnings,
  };
}
