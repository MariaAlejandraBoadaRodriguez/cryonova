/**
 * Persistence for runs and their provider reads. NeonRunStore is used in
 * deployments; MemoryRunStore backs unit tests and database-less local runs.
 */
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { NewRun, RunError, RunProgress, RunRow, RunStatus, SampleRow, SampleStatus } from "@/src/jobs/types";
import type { ProviderJobRow, ProviderJobStatus, RemoteProvider } from "@/src/providers/remote";
import { getDb, hasDatabase } from "./client";
import { connectorChecks, providerJobs, runSamples, runs } from "./schema";

/** Last real value obtained from a connector (by a run or a live probe). */
export interface ConnectorCheck {
  connector: string;
  checkedAt: Date;
  ok: boolean;
  value: number | null;
  units: string | null;
  label: string | null;
  detail: Record<string, unknown> | null;
  runId: string | null;
}

export interface FinishPatch {
  status: RunStatus;
  progress: RunProgress;
  result?: unknown;
  error?: RunError | null;
}

export interface RunStore {
  createRun(input: NewRun): Promise<{ run: RunRow; created: boolean }>;
  getRun(id: string): Promise<RunRow | null>;
  acquireLease(id: string, owner: string, ms: number): Promise<RunRow | null>;
  renewLease(id: string, owner: string, ms: number, progress: RunProgress): Promise<{ ok: boolean; cancelRequested: boolean }>;
  releaseLease(id: string, owner: string, progress: RunProgress): Promise<void>;
  finishRun(id: string, owner: string, patch: FinishPatch): Promise<boolean>;
  requestCancel(id: string): Promise<RunRow | null>;
  planSamples(rows: SampleRow[]): Promise<void>;
  saveSamples(rows: SampleRow[]): Promise<void>;
  listSamples(runId: string, statuses?: SampleStatus[]): Promise<SampleRow[]>;
  countRecentRuns(clientKey: string, since: Date): Promise<number>;
  setExplanation(id: string, explanation: unknown): Promise<void>;
  listJobs(runId: string): Promise<ProviderJobRow[]>;
  saveJob(job: ProviderJobRow): Promise<void>;
  recordConnectorCheck(check: ConnectorCheck): Promise<void>;
  listConnectorChecks(): Promise<ConnectorCheck[]>;
}

type RunRecord = typeof runs.$inferSelect;
type SampleRecord = typeof runSamples.$inferSelect;

function toRun(r: RunRecord): RunRow {
  return { ...r, status: r.status as RunStatus, progress: (r.progress ?? { phase: "queued" }) as RunProgress, error: (r.error ?? null) as RunError | null, result: (r.result ?? null) as RunRow["result"] };
}

function toSample(r: SampleRecord): SampleRow {
  return { ...r, status: r.status as SampleStatus, values: (r.values ?? null) as SampleRow["values"] };
}

type JobRecord = typeof providerJobs.$inferSelect;
type CheckRecord = typeof connectorChecks.$inferSelect;

function toJob(r: JobRecord): ProviderJobRow {
  return { ...r, provider: r.provider as RemoteProvider, status: r.status as ProviderJobStatus, meta: (r.meta ?? null) as ProviderJobRow["meta"] };
}

function toCheck(r: CheckRecord): ConnectorCheck {
  return { ...r, detail: (r.detail ?? null) as ConnectorCheck["detail"] };
}

export class NeonRunStore implements RunStore {
  private get db() {
    return getDb();
  }

  async createRun(input: NewRun) {
    const inserted = await this.db
      .insert(runs)
      .values({
        id: input.id,
        status: "queued",
        mode: input.selection.mode,
        question: input.selection.question ?? null,
        selection: input.selection,
        idempotencyKey: input.idempotencyKey,
        clientKey: input.clientKey,
        parentRunId: input.parentRunId ?? null,
        progress: { phase: "queued" },
      })
      .onConflictDoNothing({ target: runs.idempotencyKey })
      .returning();
    if (inserted[0]) return { run: toRun(inserted[0]), created: true };
    const existing = await this.db.select().from(runs).where(eq(runs.idempotencyKey, input.idempotencyKey)).limit(1);
    if (!existing[0]) throw new Error("Idempotent run lookup failed");
    return { run: toRun(existing[0]), created: false };
  }

  async getRun(id: string) {
    const rows = await this.db.select().from(runs).where(eq(runs.id, id)).limit(1);
    return rows[0] ? toRun(rows[0]) : null;
  }

  async acquireLease(id: string, owner: string, ms: number) {
    const rows = await this.db
      .update(runs)
      .set({
        status: "running",
        leaseOwner: owner,
        leaseUntil: sql`now() + make_interval(secs => ${ms / 1000})`,
        attempts: sql`${runs.attempts} + 1`,
        startedAt: sql`coalesce(${runs.startedAt}, now())`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(runs.id, id), inArray(runs.status, ["queued", "running"]), eq(runs.cancelRequested, false), or(isNull(runs.leaseUntil), lt(runs.leaseUntil, sql`now()`))))
      .returning();
    return rows[0] ? toRun(rows[0]) : null;
  }

  async renewLease(id: string, owner: string, ms: number, progress: RunProgress) {
    const rows = await this.db
      .update(runs)
      .set({ leaseUntil: sql`now() + make_interval(secs => ${ms / 1000})`, progress, updatedAt: sql`now()` })
      .where(and(eq(runs.id, id), eq(runs.leaseOwner, owner)))
      .returning({ cancelRequested: runs.cancelRequested });
    return { ok: rows.length === 1, cancelRequested: rows[0]?.cancelRequested ?? false };
  }

  async releaseLease(id: string, owner: string, progress: RunProgress) {
    await this.db
      .update(runs)
      .set({ status: "queued", leaseOwner: null, leaseUntil: null, progress, updatedAt: sql`now()` })
      .where(and(eq(runs.id, id), eq(runs.leaseOwner, owner)));
  }

  async finishRun(id: string, owner: string, patch: FinishPatch) {
    const rows = await this.db
      .update(runs)
      .set({
        status: patch.status,
        progress: patch.progress,
        result: patch.result ?? null,
        error: patch.error ?? null,
        leaseOwner: null,
        leaseUntil: null,
        finishedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(runs.id, id), eq(runs.leaseOwner, owner)))
      .returning({ id: runs.id });
    return rows.length === 1;
  }

  async requestCancel(id: string) {
    await this.db.update(runs).set({ cancelRequested: true, updatedAt: sql`now()` }).where(and(eq(runs.id, id), inArray(runs.status, ["queued", "running"])));
    // A run nobody is executing can be closed immediately.
    await this.db
      .update(runs)
      .set({ status: "cancelled", finishedAt: sql`now()`, updatedAt: sql`now()`, progress: sql`${runs.progress} || '{"phase":"done","message":"Cancelled before execution resumed"}'::jsonb` })
      .where(and(eq(runs.id, id), eq(runs.status, "queued"), or(isNull(runs.leaseUntil), lt(runs.leaseUntil, sql`now()`))));
    return this.getRun(id);
  }

  async planSamples(rows: SampleRow[]) {
    for (let i = 0; i < rows.length; i += 500) {
      await this.db.insert(runSamples).values(rows.slice(i, i + 500)).onConflictDoNothing();
    }
  }

  async saveSamples(rows: SampleRow[]) {
    if (rows.length === 0) return;
    await this.db
      .insert(runSamples)
      .values(rows)
      .onConflictDoUpdate({
        target: [runSamples.runId, runSamples.collection, runSamples.month],
        set: {
          status: sql`excluded.status`,
          values: sql`excluded.values`,
          bytes: sql`excluded.bytes`,
          durationMs: sql`excluded.duration_ms`,
          attempts: sql`excluded.attempts`,
          error: sql`excluded.error`,
          fetchedAt: sql`excluded.fetched_at`,
          via: sql`excluded.via`,
        },
      });
  }

  async listSamples(runId: string, statuses?: SampleStatus[]) {
    const where = statuses ? and(eq(runSamples.runId, runId), inArray(runSamples.status, statuses)) : eq(runSamples.runId, runId);
    const rows = await this.db.select().from(runSamples).where(where).orderBy(runSamples.collection, runSamples.month);
    return rows.map(toSample);
  }

  async countRecentRuns(clientKey: string, since: Date) {
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(runs)
      .where(and(eq(runs.clientKey, clientKey), gte(runs.createdAt, since)));
    return rows[0]?.n ?? 0;
  }

  async setExplanation(id: string, explanation: unknown) {
    await this.db.update(runs).set({ explanation, updatedAt: sql`now()` }).where(eq(runs.id, id));
  }

  async listJobs(runId: string) {
    const rows = await this.db.select().from(providerJobs).where(eq(providerJobs.runId, runId)).orderBy(providerJobs.collection, providerJobs.jobKey);
    return rows.map(toJob);
  }

  async saveJob(job: ProviderJobRow) {
    const set = {
      provider: job.provider, jobRef: job.jobRef, status: job.status, request: job.request, meta: job.meta, message: job.message,
      checkedAt: job.checkedAt, nextCheckAt: job.nextCheckAt, completedAt: job.completedAt, checks: job.checks,
    };
    await this.db.insert(providerJobs).values(job).onConflictDoUpdate({ target: [providerJobs.runId, providerJobs.collection, providerJobs.jobKey], set });
  }

  async recordConnectorCheck(check: ConnectorCheck) {
    const set = { checkedAt: check.checkedAt, ok: check.ok, value: check.value, units: check.units, label: check.label, detail: check.detail, runId: check.runId };
    await this.db.insert(connectorChecks).values(check).onConflictDoUpdate({ target: connectorChecks.connector, set });
  }

  async listConnectorChecks() {
    const rows = await this.db.select().from(connectorChecks);
    return rows.map(toCheck);
  }
}

/** In-process store with the same semantics, for tests and database-less development. */
export class MemoryRunStore implements RunStore {
  readonly runs = new Map<string, RunRow>();
  readonly samples = new Map<string, SampleRow>();
  private now = () => new Date();

  private key(s: Pick<SampleRow, "runId" | "collection" | "month">) {
    return `${s.runId}|${s.collection}|${s.month}`;
  }

  async createRun(input: NewRun) {
    const existing = [...this.runs.values()].find((r) => r.idempotencyKey === input.idempotencyKey);
    if (existing) return { run: structuredClone(existing), created: false };
    const now = this.now();
    const run: RunRow = {
      id: input.id, createdAt: now, updatedAt: now, status: "queued", mode: input.selection.mode, question: input.selection.question ?? null,
      selection: input.selection, idempotencyKey: input.idempotencyKey, clientKey: input.clientKey, parentRunId: input.parentRunId ?? null,
      progress: { phase: "queued" }, leaseOwner: null, leaseUntil: null, attempts: 0, cancelRequested: false, startedAt: null, finishedAt: null,
      error: null, result: null, explanation: null,
    };
    this.runs.set(run.id, run);
    return { run: structuredClone(run), created: true };
  }

  async getRun(id: string) {
    const run = this.runs.get(id);
    return run ? structuredClone(run) : null;
  }

  async acquireLease(id: string, owner: string, ms: number) {
    const run = this.runs.get(id);
    const now = this.now();
    if (!run || !["queued", "running"].includes(run.status) || run.cancelRequested) return null;
    if (run.leaseUntil && run.leaseUntil > now) return null;
    Object.assign(run, { status: "running", leaseOwner: owner, leaseUntil: new Date(now.getTime() + ms), attempts: run.attempts + 1, startedAt: run.startedAt ?? now, updatedAt: now });
    return structuredClone(run);
  }

  async renewLease(id: string, owner: string, ms: number, progress: RunProgress) {
    const run = this.runs.get(id);
    if (!run || run.leaseOwner !== owner) return { ok: false, cancelRequested: run?.cancelRequested ?? false };
    Object.assign(run, { leaseUntil: new Date(this.now().getTime() + ms), progress: structuredClone(progress), updatedAt: this.now() });
    return { ok: true, cancelRequested: run.cancelRequested };
  }

  async releaseLease(id: string, owner: string, progress: RunProgress) {
    const run = this.runs.get(id);
    if (run && run.leaseOwner === owner) Object.assign(run, { status: "queued", leaseOwner: null, leaseUntil: null, progress: structuredClone(progress) });
  }

  async finishRun(id: string, owner: string, patch: FinishPatch) {
    const run = this.runs.get(id);
    if (!run || run.leaseOwner !== owner) return false;
    Object.assign(run, { status: patch.status, progress: structuredClone(patch.progress), result: structuredClone(patch.result ?? null), error: patch.error ?? null, leaseOwner: null, leaseUntil: null, finishedAt: this.now() });
    return true;
  }

  async requestCancel(id: string) {
    const run = this.runs.get(id);
    if (!run) return null;
    if (["queued", "running"].includes(run.status)) run.cancelRequested = true;
    if (run.status === "queued" && (!run.leaseUntil || run.leaseUntil <= this.now())) {
      Object.assign(run, { status: "cancelled", finishedAt: this.now(), progress: { ...run.progress, phase: "done", message: "Cancelled before execution resumed" } });
    }
    return structuredClone(run);
  }

  async planSamples(rows: SampleRow[]) {
    for (const row of rows) if (!this.samples.has(this.key(row))) this.samples.set(this.key(row), structuredClone(row));
  }

  async saveSamples(rows: SampleRow[]) {
    for (const row of rows) this.samples.set(this.key(row), structuredClone(row));
  }

  async listSamples(runId: string, statuses?: SampleStatus[]) {
    return [...this.samples.values()]
      .filter((s) => s.runId === runId && (!statuses || statuses.includes(s.status)))
      .sort((a, b) => a.collection.localeCompare(b.collection) || a.month.localeCompare(b.month))
      .map((s) => structuredClone(s));
  }

  async countRecentRuns(clientKey: string, since: Date) {
    return [...this.runs.values()].filter((r) => r.clientKey === clientKey && r.createdAt >= since).length;
  }

  async setExplanation(id: string, explanation: unknown) {
    const run = this.runs.get(id);
    if (run) run.explanation = structuredClone(explanation);
  }

  readonly jobs = new Map<string, ProviderJobRow>();
  readonly checks = new Map<string, ConnectorCheck>();

  async listJobs(runId: string) {
    return [...this.jobs.values()].filter((j) => j.runId === runId).map((j) => structuredClone(j));
  }

  async saveJob(job: ProviderJobRow) {
    this.jobs.set(`${job.runId}|${job.collection}|${job.jobKey}`, structuredClone(job));
  }

  async recordConnectorCheck(check: ConnectorCheck) {
    this.checks.set(check.connector, structuredClone(check));
  }

  async listConnectorChecks() {
    return [...this.checks.values()].map((c) => structuredClone(c));
  }
}

let memory: MemoryRunStore | null = null;

/** Neon when DATABASE_URL is configured, otherwise a process-local memory store. */
export function getRunStore(): RunStore {
  if (hasDatabase()) return new NeonRunStore();
  memory ??= new MemoryRunStore();
  return memory;
}
