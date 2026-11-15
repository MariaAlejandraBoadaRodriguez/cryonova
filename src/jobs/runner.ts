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
import { accessOf, collectionOf, getCollection, getVariable, productLabel, servedBy } from "@/src/catalog";
import { derivedVariable, derivePoints, getDerived } from "@/src/catalog/derived";
import { crossesAntimeridian } from "@/src/catalog/regions";
import type { AccessKind, CatalogVariable, CollectionSpec } from "@/src/catalog/types";
import type { RunStore } from "@/src/db/store";
import { ProviderError } from "@/src/lib/http";
import { config } from "@/src/lib/env";
import { errorMessage, type Logger, logger as rootLogger } from "@/src/lib/log";
import { cdsConnector } from "@/src/providers/cds";
import { findGranules } from "@/src/providers/cmr";
import type { GridWindow } from "@/src/providers/grid";
import { planWindow, readGranule } from "@/src/providers/gridded";
import { harmonyConnector } from "@/src/providers/harmony";
import { era5GridStep, OBDAAC_FILE_FALLBACK_MONTHS } from "@/src/providers/limits";
import { noaaConnector, type StationInfo } from "@/src/providers/noaa";
import { readObdaacGranule } from "@/src/providers/obdaac";
import { POLICIES, withSignal } from "@/src/providers/policies";
import {
  type FetchedMonth,
  isWaiting,
  nextCheckDelaySeconds,
  type ProviderJobRow,
  type RemoteConnector,
  type RemoteContext,
  type RemoteCredentials,
  type RemoteProvider,
} from "@/src/providers/remote";
import { groupByCollection, type Selection, SelectionSchema } from "./selection";
import type { RunProgress, RunResult, RunRow, SampleRow, SourceProvenance, StationResult, VariableResult } from "./types";

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
  /** Credentials for CDS, NOAA and Harmony; defaults to the server configuration. */
  credentials?: RemoteCredentials;
  /** Test seam: replace remote connectors. */
  connectors?: Partial<Record<RemoteProvider, RemoteConnector>>;
  now?: () => Date;
  /** Full-file OB.DAAC fallback reads allowed per run (each file is ~10.7 MB). */
  obdaacFileLimit?: number;
}

const DEFAULT_BUDGET_MS = 240_000;
const DEFAULT_LEASE_MS = 60_000;
const OBDAAC_CONCURRENCY = 2;

const REMOTE: AccessKind[] = ["cds", "harmony", "noaa-cdo"];
export const isRemoteAccess = (access: AccessKind): access is RemoteProvider => REMOTE.includes(access);
const NEEDS_EARTHDATA: AccessKind[] = ["opendap", "obdaac", "harmony"];

const PROVIDER_NAMES: Record<RemoteProvider, string> = { cds: "Copernicus CDS", harmony: "NASA Harmony (Giovanni)", "noaa-cdo": "NOAA CDO" };

function waitingMessage(jobs: ProviderJobRow[]): string {
  const parts = jobs.map((j) => {
    const since = j.submittedAt.toISOString().slice(11, 16);
    const ref = j.jobRef ? ` ${j.jobRef.slice(0, 8)}` : "";
    return `${PROVIDER_NAMES[j.provider]} job${ref} ${j.status} since ${since} UTC (${j.checks} check${j.checks === 1 ? "" : "s"})`;
  });
  const cds = jobs.some((j) => j.provider === "cds") ? " Copernicus queues can take from minutes to hours; this page keeps checking while it is open, and the run resumes whenever someone opens it again." : "";
  return `Waiting for the provider: ${parts.join("; ")}.${cds}`;
}

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

/** Remembers each connector's latest real value (shown on /sources). Best effort. */
export async function recordConnectorValues(store: RunStore, result: RunResult): Promise<void> {
  for (const source of result.sources) {
    if (source.monthsRead === 0) continue;
    const collection = getCollection(source.collection);
    const variable = result.variables.find((v) => v.collection === source.collection);
    const last = variable?.analysis.monthly.filter((p) => p.value !== null).at(-1);
    if (!collection || !variable || !last || last.value === null) continue;
    await store.recordConnectorCheck({
      connector: collection.source,
      checkedAt: new Date(),
      ok: true,
      value: last.value,
      units: variable.analysis.units,
      label: `${variable.name.en} · ${result.region.name ?? "custom area"} · ${last.month}`,
      detail: { runId: result.runId, collection: source.collection, variable: variable.key, month: last.month, monthsRead: source.monthsRead, monthsRequested: source.monthsRequested, bytes: source.bytes, jobRef: source.jobs?.[0]?.jobRef ?? null, via: source.readsVia ?? null, kind: source.kind ?? "grid" },
      runId: result.runId,
    });
  }
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
  const months = monthsBetween(selection.start, selection.end);
  const groups = groupByCollection(selection);
  const controller = new AbortController();
  const now = deps.now ?? (() => new Date());
  const token = deps.earthdataToken ?? config.earthdataToken;
  const needsEarthdata = [...groups.keys()].some((name) => NEEDS_EARTHDATA.includes(accessOf(getCollection(name)!)));
  if (needsEarthdata && !token) return fail("configuration", "The NASA Earthdata token is not configured on the server. An administrator must set EARTHDATA_TOKEN.");
  const credentials: RemoteCredentials = deps.credentials ?? { earthdataToken: token, cdsKey: config.cdsKey, cdsUrl: config.cdsUrl, noaaToken: config.noaaToken };
  const connectors: Record<RemoteProvider, RemoteConnector> = { cds: cdsConnector, harmony: harmonyConnector, "noaa-cdo": noaaConnector, ...deps.connectors };
  const contextFor = (name: string): RemoteContext => ({
    runId,
    collection: getCollection(name)!,
    variables: (groups.get(name) ?? []).map((k) => getVariable(k)!),
    bbox: selection.region.bbox,
    start: selection.start,
    end: selection.end,
    months,
    credentials,
    fetchImpl: deps.fetchImpl,
    signal: controller.signal,
  });

  /** Plans the months as pending rows and submits the provider job(s) once. */
  const submitRemote = async (collectionName: string, access: RemoteProvider, existing: ProviderJobRow[]) => {
    await store.planSamples(
      months.map((month) => ({
        runId, collection: collectionName, month, status: "pending", granuleId: null, granuleTitle: null, opendapUrl: null,
        values: null, bytes: null, durationMs: null, attempts: 0, error: null, fetchedAt: null, via: access,
      })),
    );
    const ctx = contextFor(collectionName);
    const connector = connectors[access];
    for (const jobKey of connector.jobKeys(ctx)) {
      if (existing.some((j) => j.collection === collectionName && j.jobKey === jobKey)) continue;
      const submittedAt = now();
      const base: ProviderJobRow = {
        runId, collection: collectionName, jobKey, provider: access, jobRef: null, status: "submitted", request: null, meta: null, message: null,
        submittedAt, checkedAt: null, nextCheckAt: null, completedAt: null, checks: 0,
      };
      try {
        const out = await connector.submit(ctx, jobKey);
        await store.saveJob({
          ...base, jobRef: out.jobRef, status: out.status, request: out.request, meta: out.meta ?? null, message: out.message ?? null, checkedAt: submittedAt,
          nextCheckAt: isWaiting(out.status) ? new Date(submittedAt.getTime() + nextCheckDelaySeconds(0) * 1000) : null,
        });
        log.info("run.job.submitted", { collection: collectionName, provider: access, jobRef: out.jobRef, status: out.status });
      } catch (error) {
        if (error instanceof ProviderError && error.kind === "cancelled") throw error;
        const message = error instanceof ProviderError ? `${error.kind}: ${error.message}` : errorMessage(error);
        await store.saveJob({ ...base, status: "failed", message: `Submission failed: ${message}`.slice(0, 500), completedAt: now() });
        log.warn("run.job.submit_failed", { collection: collectionName, provider: access, error: message.slice(0, 200) });
      }
    }
  };

  /**
   * One pass over the run's provider jobs: a short status check when one is due,
   * the download once a job is ready, and the monthly rows once every job of a
   * collection is done. Returns the jobs still waiting on a provider.
   */
  const advanceRemote = async (): Promise<ProviderJobRow[]> => {
    const jobs = await store.listJobs(runId);
    for (const original of jobs) {
      let job = original;
      const ctx = contextFor(job.collection);
      const connector = connectors[job.provider];
      if (isWaiting(job.status) && (!job.nextCheckAt || job.nextCheckAt.getTime() <= now().getTime()) && Date.now() < deadline) {
        const checkedAt = now();
        try {
          const out = await connector.check(ctx, job);
          job = {
            ...job, status: out.status, message: out.message ?? job.message, meta: { ...(job.meta ?? {}), ...(out.meta ?? {}) }, checks: job.checks + 1, checkedAt,
            nextCheckAt: isWaiting(out.status) ? new Date(checkedAt.getTime() + nextCheckDelaySeconds(job.checks + 1) * 1000) : null,
            completedAt: out.status === "failed" ? checkedAt : job.completedAt,
          };
        } catch (error) {
          if (error instanceof ProviderError && error.kind === "cancelled") throw error;
          const fatal = error instanceof ProviderError && ["unauthorized", "forbidden", "not_found", "bad_request"].includes(error.kind);
          const message = error instanceof ProviderError ? `${error.kind}: ${error.message}` : errorMessage(error);
          job = {
            ...job, status: fatal ? "failed" : job.status, message: `${fatal ? "Status check failed" : "Status check will be retried"}: ${message}`.slice(0, 500), checks: job.checks + 1, checkedAt,
            nextCheckAt: fatal ? null : new Date(checkedAt.getTime() + nextCheckDelaySeconds(job.checks + 1) * 1000), completedAt: fatal ? checkedAt : null,
          };
        }
        await store.saveJob(job);
      }
      if (job.status === "successful" && Date.now() < deadline) {
        try {
          const out = await connector.fetch(ctx, job);
          job = { ...job, status: "fetched", completedAt: now(), message: `${job.message ?? ""}`.trim() || null, meta: { ...(job.meta ?? {}), ...(out.meta ?? {}), months: out.months, bytes: out.bytes, fetchMs: out.durationMs, fetchAttempts: out.attempts, exampleRequest: out.exampleRequest } };
          log.info("run.job.fetched", { collection: job.collection, provider: job.provider, bytes: out.bytes, ms: out.durationMs, months: out.months.length });
        } catch (error) {
          if (error instanceof ProviderError && error.kind === "cancelled") throw error;
          const tries = Number(job.meta?.downloadFailures ?? 0) + 1;
          const message = error instanceof ProviderError ? `${error.kind}: ${error.message}` : errorMessage(error);
          const retry = error instanceof ProviderError && error.retryable && tries < 3;
          job = {
            ...job, status: retry ? "successful" : "failed", message: `${retry ? "Result download will be retried" : "Result could not be read"}: ${message}`.slice(0, 500),
            meta: { ...(job.meta ?? {}), downloadFailures: tries }, completedAt: retry ? null : now(),
          };
          log.warn("run.job.fetch_failed", { collection: job.collection, provider: job.provider, error: message.slice(0, 200), retry });
        }
        await store.saveJob(job);
      }
      jobs[jobs.indexOf(original)] = job;
    }

    // Collections whose jobs are all done get their monthly rows.
    const pending = await store.listSamples(runId, ["pending"]);
    for (const collectionName of new Set(jobs.map((j) => j.collection))) {
      const own = jobs.filter((j) => j.collection === collectionName);
      if (own.some((j) => isWaiting(j.status) || j.status === "successful")) continue;
      const rows = pending.filter((r) => r.collection === collectionName);
      if (rows.length === 0) continue;
      const fetched = own.filter((j) => j.status === "fetched");
      const byMonth = new Map<string, FetchedMonth["values"]>();
      for (const job of fetched) for (const m of (job.meta?.months ?? []) as FetchedMonth[]) byMonth.set(m.month, [...(byMonth.get(m.month) ?? []), ...m.values]);
      const failure = own.find((j) => j.status === "failed")?.message ?? null;
      const bytes = fetched.reduce((sum, j) => sum + Number(j.meta?.bytes ?? 0), 0);
      const fetchMs = fetched.reduce((sum, j) => Math.max(sum, Number(j.meta?.fetchMs ?? 0)), 0);
      const updated = rows.map((row, i): SampleRow => {
        const values = byMonth.get(row.month) ?? null;
        const ok = values !== null && values.some((v) => v.mean !== null);
        return {
          ...row,
          status: fetched.length === 0 ? "failed" : ok ? "ok" : "missing",
          values,
          granuleTitle: fetched.map((j) => j.jobRef).filter(Boolean).join(", ") || null,
          bytes: i === 0 ? bytes : 0,
          durationMs: i === 0 ? fetchMs : 0,
          attempts: 1,
          error: fetched.length === 0 ? (failure ?? "Provider job failed") : ok ? null : "No value returned for this month",
          fetchedAt: fetched[0]?.completedAt ?? now(),
        };
      });
      await store.saveSamples(updated);
    }
    return jobs.filter((j) => isWaiting(j.status) || j.status === "successful");
  };

  try {
    // Phase 1: discovery. Planned rows make later phases idempotent.
    if (progress.phase === "queued" || progress.phase === "discovering") {
      progress.phase = "discovering";
      const started = Date.now();
      const existingJobs = await store.listJobs(runId);
      for (const collectionName of groups.keys()) {
        const collection = getCollection(collectionName)!;
        const access = accessOf(collection);
        if (isRemoteAccess(access)) {
          await submitRemote(collectionName, access, existingJobs);
          continue;
        }
        const found = await findGranules(collection.conceptId, selection.start, selection.end, withSignal(POLICIES.cmrSearch, controller.signal), deps.fetchImpl, { titleFilter: collection.granuleTitleFilter });
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
      const isGriddedRow = (row: SampleRow) => !isRemoteAccess(accessOf(getCollection(row.collection)!));
      const pending = (await store.listSamples(runId, ["pending"])).filter(isGriddedRow);
      const all = await store.listSamples(runId);
      const fileLimit = deps.obdaacFileLimit ?? OBDAAC_FILE_FALLBACK_MONTHS;
      let cloudFiles = all.filter((r) => r.via === "cloud-file").length;
      const allowCloudFile = () => {
        if (cloudFiles >= fileLimit) return false;
        cloudFiles += 1;
        return true;
      };
      const breaker = { rateLimited: 0, threshold: 2 };
      progress.tasksTotal = all.length;
      progress.tasksMissing = all.filter((s) => s.status === "missing").length;
      progress.tasksDone = all.filter((s) => s.status === "ok").length;
      progress.tasksFailed = all.filter((s) => s.status === "failed").length;
      progress.bytes = all.reduce((sum, s) => sum + (s.bytes ?? 0), 0);

      const windows = new Map([...groups.keys()].filter((name) => !isRemoteAccess(accessOf(getCollection(name)!))).map((name) => [name, planWindow(getCollection(name)!, selection.region.bbox)]));
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

      const worker = async (task: SampleRow) => {
          const collection = getCollection(task.collection)!;
          const started = Date.now();
          try {
            const variables = variablesByCollection.get(task.collection)!;
            const window = windows.get(task.collection)!;
            const read =
              accessOf(collection) === "obdaac"
                ? await readObdaacGranule(task.opendapUrl!, collection, variables, window, { token: token!, policy: withSignal(POLICIES.obdaacOpendap, controller.signal), fetchImpl: deps.fetchImpl, allowCloudFile, breaker })
                : { ...(await readGranule(task.opendapUrl!, collection, variables, window, { token: token!, policy: withSignal(POLICIES.opendapRead, controller.signal), fetchImpl: deps.fetchImpl })), via: "opendap" as const };
            buffer.push({ ...task, status: "ok", values: read.values, bytes: read.bytes, durationMs: read.durationMs, attempts: task.attempts + read.attempts, error: null, fetchedAt: new Date(), via: read.via });
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
      };
      const stop = () => cancelled || Date.now() > deadline;
      const obdaacTasks = pending.filter((t) => accessOf(getCollection(t.collection)!) === "obdaac");
      const otherTasks = pending.filter((t) => accessOf(getCollection(t.collection)!) !== "obdaac");
      // OB.DAAC rate-limits busy clients: its reads get their own, smaller pool.
      await Promise.all([pool(otherTasks, concurrency, worker, stop), pool(obdaacTasks, Math.min(concurrency, OBDAAC_CONCURRENCY), worker, stop)]);
      await flush(true);
      const waiting = cancelled ? [] : await advanceRemote();
      timings.readWallMs = (timings.readWallMs ?? 0) + (Date.now() - readStart);

      if (cancelled) {
        progress.phase = "done";
        progress.message = "Cancelled by the user";
        await store.finishRun(runId, owner, { status: "cancelled", progress: { ...progress, timings } });
        log.info("run.cancelled", { done: progress.tasksDone });
        return store.getRun(runId);
      }
      const remaining = await store.listSamples(runId, ["pending"]);
      const griddedLeft = remaining.filter(isGriddedRow).length;
      progress.jobs = (await store.listJobs(runId)).map((j) => ({ collection: j.collection, provider: j.provider, jobRef: j.jobRef, status: j.status, message: j.message, submittedAt: j.submittedAt.toISOString(), checks: j.checks }));
      if (remaining.length > 0) {
        if (griddedLeft > 0 || waiting.length === 0) {
          progress.message = `Paused after this invocation's time budget; ${remaining.length} reads remain and will resume automatically.`;
          delete progress.waitUntil;
        } else {
          const due = Math.min(...waiting.map((j) => j.nextCheckAt?.getTime() ?? now().getTime()));
          progress.waitUntil = new Date(Math.max(due, now().getTime() + 5_000)).toISOString();
          progress.message = waitingMessage(waiting);
        }
        await store.releaseLease(runId, owner, { ...progress, timings });
        log.info("run.paused", { remaining: remaining.length, waitingJobs: waiting.length });
        return store.getRun(runId);
      }
      delete progress.waitUntil;
      progress.phase = "analyzing";
    }

    // Phase 3: analysis from the persisted reads only.
    const analysisStart = Date.now();
    const samples = await store.listSamples(runId);
    const jobs = await store.listJobs(runId);
    const result = buildResult(run, selection, samples, { ...timings, analysisStart, invocationStart, concurrency, invocations: progress.invocations ?? 1 }, jobs);
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
    await recordConnectorValues(store, result).catch((error) => log.warn("run.connector_check.failed", { error: errorMessage(error) }));
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

const ACCESS_TEXT: Record<AccessKind, string> = {
  opendap: "NASA Earthdata Cloud OPeNDAP (DAP2 binary subset), Earthdata Login bearer token held on the server",
  obdaac: "NASA OB.DAAC OPeNDAP (DAP2 binary subset), with a bounded fallback to the full monthly cloud file (signed link, NetCDF-4 read with h5wasm)",
  cds: "Copernicus CDS retrieve job (asynchronous: submitted once, checked on later polls); NetCDF-4 result fetched from a signed link without credentials and read with h5wasm",
  harmony: "NASA Harmony job served by Giovanni's area-averaging service (asynchronous); CSV result fetched from a signed link without credentials",
  "noaa-cdo": "NOAA Climate Data Online web services v2 (GSOM, units=metric), token held on the server",
};

/** The cells (or stations) behind a source's values, for provenance and coverage. */
function sourceWindow(collection: CollectionSpec, selection: Selection, jobs: ProviderJobRow[]): GridWindow {
  const access = accessOf(collection);
  if (access === "noaa-cdo") {
    const meta = jobs[0]?.meta ?? {};
    const stations = (meta.stations ?? []) as StationInfo[];
    const used = new Set(Object.values((meta.used ?? {}) as Record<string, string[]>).flat());
    return { lat: { start: 0, stop: 0, stride: 1 }, lon: [], cells: used.size, nativeCells: stations.length, stride: 1, snapped: false };
  }
  if (access === "cds") {
    const months = monthsBetween(selection.start, selection.end).length;
    const step = Number(jobs[0]?.meta?.gridStep ?? era5GridStep(selection.region.bbox, months, groupByCollection(selection).get(collection.shortName)?.length ?? 1));
    const native = planWindow(collection, selection.region.bbox, Number.MAX_SAFE_INTEGER);
    const stride = Math.max(1, Math.round(step / 0.25));
    const decoded = Number(jobs[0]?.meta?.cellsPerMonth ?? 0);
    const count = (r: { start: number; stop: number }) => Math.floor((r.stop - r.start) / stride) + 1;
    return { ...native, stride, lat: { ...native.lat, stride }, lon: native.lon.map((p) => ({ ...p, stride })), cells: decoded || count(native.lat) * native.lon.reduce((sum, p) => sum + count(p), 0) };
  }
  return planWindow(collection, selection.region.bbox, access === "harmony" ? Number.MAX_SAFE_INTEGER : undefined);
}

function stationResults(variable: CatalogVariable, rows: SampleRow[], months: string[], job: ProviderJobRow | undefined): StationResult[] {
  const stations = (job?.meta?.stations ?? []) as StationInfo[];
  const used = new Set(((job?.meta?.used ?? {}) as Record<string, string[]>)[variable.key] ?? []);
  const byMonth = new Map(rows.map((r) => [r.month, r.values?.find((v) => v.key === variable.key)?.points ?? []]));
  return stations
    .map((station) => {
      const points: MonthlyPoint[] = months.map((month) => {
        const value = byMonth.get(month)?.find((p) => p.id === station.id)?.value;
        return { month, value: value ?? null, validCells: value === undefined ? 0 : 1, totalCells: 1 };
      });
      const analysis = analyzeVariable({ variable, points, monthsWithGranule: months.length, failedMonths: [], window: { cells: 1, nativeCells: 1, stride: 1, snapped: false } });
      const valid = analysis.monthly.filter((p) => p.value !== null);
      return {
        id: station.id, name: station.name, lat: station.lat, lon: station.lon, elevation: station.elevation,
        monthsValid: valid.length, mean: analysis.stats.mean, usedInRegionalMean: used.has(station.id),
        trendPerDecade: analysis.trend.status === "ok" ? analysis.trend.slopePerDecade : null,
        trendPValue: analysis.trend.status === "ok" ? analysis.trend.pValue : null,
        firstMonth: valid[0]?.month ?? null, lastMonth: valid[valid.length - 1]?.month ?? null,
        monthly: analysis.monthly.map((p) => ({ month: p.month, value: p.value })),
      };
    })
    .filter((s) => s.monthsValid > 0)
    .sort((a, b) => Number(b.usedInRegionalMean) - Number(a.usedInRegionalMean) || b.monthsValid - a.monthsValid);
}

export function buildResult(run: RunRow, selection: Selection, samples: SampleRow[], t: TimingInput, jobs: ProviderJobRow[] = []): RunResult {
  const months = monthsBetween(selection.start, selection.end);
  const warnings: string[] = [];
  const sources: SourceProvenance[] = [];
  const variables: VariableResult[] = [];

  for (const [collectionName, keys] of groupByCollection(selection)) {
    const collection = getCollection(collectionName)!;
    const access = accessOf(collection);
    const remote = isRemoteAccess(access);
    const ownJobs = jobs.filter((j) => j.collection === collectionName);
    const rows = samples.filter((s) => s.collection === collectionName);
    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const window = sourceWindow(collection, selection, ownJobs);
    const ok = rows.filter((r) => r.status === "ok");
    const failed = rows.filter((r) => r.status === "failed");
    const missing = rows.filter((r) => r.status === "missing");
    const durations = ok.map((r) => r.durationMs ?? 0).sort((a, b) => a - b);
    const fetched = ok.map((r) => r.fetchedAt).filter((d): d is Date => d instanceof Date).sort((a, b) => a.getTime() - b.getTime());
    const example = ok[0]?.opendapUrl ?? null;
    const cloudFile = ok.filter((r) => r.via === "cloud-file").length;
    const label = productLabel(collection);

    if (!remote && window.stride > 1) warnings.push(`${collectionName}: the region was subsampled every ${window.stride} cells to bound request size.`);
    if (access === "cds" && window.stride > 1) warnings.push(`${collectionName}: ERA5 was requested on a ${(window.stride * 0.25).toFixed(2)}° grid (native 0.25°) to keep the job result small.`);
    if (!remote && window.snapped) warnings.push(`${collectionName}: the region is smaller than one grid cell; the nearest cell was used.`);
    if (failed.length > 0) warnings.push(`${collectionName}: ${failed.length} monthly reads failed and are treated as missing.${remote && ownJobs.some((j) => j.status === "failed") ? ` ${ownJobs.find((j) => j.status === "failed")?.message ?? ""}` : ""}`.trim());
    if (missing.length > 0) warnings.push(remote ? `${collectionName}: the provider returned no value for ${missing.length} requested months.` : `${collectionName}: ${missing.length} requested months have no published granule.`);
    if (cloudFile > 0) warnings.push(`${collectionName}: ${cloudFile} months were read from full OB.DAAC files because the OPeNDAP subset service was unavailable.`);
    if (access === "noaa-cdo" && window.cells === 0) warnings.push(`${collectionName}: no station inside the area reported at least a quarter of the months, so there is no regional series; the stations' own values are shown as point data.`);

    const firstJob = ownJobs[0];
    const jobRequest = (firstJob?.request ?? {}) as { url?: string; urls?: string[] };
    sources.push({
      collection: collectionName,
      conceptId: collection.conceptId,
      version: collection.version,
      title: collection.title,
      provider: collection.provider,
      doi: collection.doi ?? null,
      citation: collection.citation,
      landingPage: collection.landingPage,
      cmrQuery: remote
        ? (jobRequest.url ?? jobRequest.urls?.[0] ?? collection.landingPage)
        : `https://cmr.earthdata.nasa.gov/search/granules.json?collection_concept_id=${collection.conceptId}&temporal=${selection.start}..${selection.end}${collection.granuleTitleFilter ? `&readable_granule_name=*${collection.granuleTitleFilter}*` : ""}`,
      granulesFound: rows.length - missing.length,
      monthsRequested: months.length,
      monthsRead: ok.length,
      monthsFailed: failed.length,
      monthsMissing: missing.length,
      firstGranule: remote ? (firstJob?.jobRef ?? null) : (ok[0]?.granuleTitle ?? null),
      lastGranule: remote ? (ownJobs[ownJobs.length - 1]?.jobRef ?? null) : (ok[ok.length - 1]?.granuleTitle ?? null),
      exampleRequest: remote ? (typeof firstJob?.meta?.exampleRequest === "string" ? safeUrl(firstJob.meta.exampleRequest) : null) : example ? safeUrl(`${example}.dods?…`) : null,
      fetchedFrom: fetched[0]?.toISOString() ?? null,
      fetchedTo: fetched[fetched.length - 1]?.toISOString() ?? null,
      bytes: rows.reduce((sum, r) => sum + (r.status === "ok" || r.status === "missing" ? (r.bytes ?? 0) : 0), 0),
      readMs: { median: percentile(durations, 50), p95: percentile(durations, 95), max: durations[durations.length - 1] ?? 0 },
      window: { lat: window.lat, lon: window.lon, cells: window.cells, nativeCells: window.nativeCells, stride: window.stride, snapped: window.snapped, resolution: collection.grid.resolutionLabel },
      access: ACCESS_TEXT[access],
      kind: access === "noaa-cdo" ? "stations" : access === "harmony" ? "service" : "grid",
      servedBy: servedBy(collection),
      label,
      ...(ownJobs.length > 0
        ? { jobs: ownJobs.filter((j) => j.provider !== "noaa-cdo").map((j) => ({ provider: j.provider, jobRef: j.jobRef, status: j.status, submittedAt: j.submittedAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null, checks: j.checks, message: j.message })) }
        : {}),
      ...(access === "obdaac" ? { readsVia: { opendap: ok.length - cloudFile, cloudFile } } : {}),
      ...(access === "noaa-cdo" ? { stations: ((firstJob?.meta?.stations ?? []) as StationInfo[]).map((st) => ({ id: st.id, name: st.name, lat: st.lat, lon: st.lon, elevation: st.elevation })) } : {}),
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
        aggregation: variable.aggregation, analysis, geometry: variable.geometry ?? "grid",
        ...(variable.geometry === "stations" ? { stations: stationResults(variable, rows, months, firstJob) } : {}),
      });
    }
  }

  // Derived series (differences, wind-vector magnitudes) from the regional monthly means above.
  for (const key of selection.derived ?? []) {
    const metric = getDerived(key);
    if (!metric) continue;
    const inputs = metric.inputs.map((k) => variables.find((v) => v.key === k));
    if (inputs.some((v) => v === undefined)) {
      warnings.push(`${metric.formula}: an input variable is missing, so the derived series was not computed.`);
      continue;
    }
    const present = inputs as VariableResult[];
    const firstInput = getVariable(present[0]!.key)!;
    const collection = getCollection(firstInput.collection)!;
    const variable = derivedVariable(metric, firstInput);
    const analysis = analyzeVariable({
      variable,
      points: derivePoints(metric, present.map((v) => v.analysis.monthly)),
      monthsWithGranule: Math.min(...present.map((v) => v.analysis.coverage.monthsWithGranule)),
      failedMonths: [...new Set(present.flatMap((v) => v.analysis.coverage.failedMonths))].sort(),
      window: planWindow(collection, selection.region.bbox),
    });
    variables.push({
      key: metric.key, name: metric.name, source: firstInput.source, collection: collection.shortName, product: collection.shortName, version: collection.version,
      dapName: metric.formula, providerLongName: metric.description.en, domain: variable.domain, unitGroup: metric.display.group,
      aggregation: variable.aggregation, analysis,
    });
  }

  // Station observations count as data even when no regional series could be formed.
  const anyValid = variables.some((v) => v.analysis.coverage.monthsValid > 0 || (v.stations?.length ?? 0) > 0);
  const stationOnly = variables.some((v) => v.analysis.coverage.monthsValid === 0 && (v.stations?.length ?? 0) > 0);
  const anyGap = sources.some((s) => s.monthsFailed > 0);
  const now = Date.now();
  const readSumMs = samples.reduce((sum, s) => sum + (s.status === "ok" ? (s.durationMs ?? 0) : 0), 0);
  return {
    schemaVersion: 1,
    runId: run.id,
    status: !anyValid ? "failed" : anyGap || stationOnly ? "partial" : "succeeded",
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
