/**
 * Database schema (Neon PostgreSQL). Changes must stay additive so the
 * previous deployment keeps working during rollbacks (decision log D-13).
 */
import { sql } from "drizzle-orm";
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** One live query execution. Its state survives function restarts. */
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(),
    mode: text("mode").notNull(),
    question: text("question"),
    selection: jsonb("selection").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    clientKey: text("client_key"),
    parentRunId: uuid("parent_run_id"),
    progress: jsonb("progress").notNull().default(sql`'{}'::jsonb`),
    leaseOwner: text("lease_owner"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    error: jsonb("error"),
    result: jsonb("result"),
    explanation: jsonb("explanation"),
  },
  (t) => [index("runs_status_lease_idx").on(t.status, t.leaseUntil), index("runs_client_created_idx").on(t.clientKey, t.createdAt)],
);

/**
 * One provider read: a collection and month inside a run. Rows are planned as
 * "pending" during discovery and updated in place, so resumed runs only read
 * what is left (idempotent by primary key).
 */
export const runSamples = pgTable(
  "run_samples",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    month: text("month").notNull(),
    status: text("status").notNull(),
    granuleId: text("granule_id"),
    granuleTitle: text("granule_title"),
    opendapUrl: text("opendap_url"),
    values: jsonb("values"),
    bytes: integer("bytes"),
    durationMs: integer("duration_ms"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    /** How the value was obtained when there is more than one path (e.g. "opendap" or "cloud-file" for OB.DAAC). */
    via: text("via"),
  },
  (t) => [primaryKey({ columns: [t.runId, t.collection, t.month] }), index("run_samples_status_idx").on(t.runId, t.status)],
);

/**
 * Provider-side work for a run that is not a month-by-month OPeNDAP read: an
 * asynchronous job (Copernicus CDS, NASA Harmony) or a NOAA station selection.
 * Submitted once, then checked with short requests on later invocations
 * (client polling), so no request waits for the provider.
 */
export const providerJobs = pgTable(
  "provider_jobs",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    collection: text("collection").notNull(),
    jobKey: text("job_key").notNull(),
    provider: text("provider").notNull(),
    jobRef: text("job_ref"),
    status: text("status").notNull(),
    request: jsonb("request"),
    meta: jsonb("meta"),
    message: text("message"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    checks: integer("checks").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.runId, t.collection, t.jobKey] }), index("provider_jobs_status_idx").on(t.status, t.nextCheckAt)],
);

/** The last real value each connector returned (from a run or a live probe), shown on /sources. */
export const connectorChecks = pgTable("connector_checks", {
  connector: text("connector").primaryKey(),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  ok: boolean("ok").notNull(),
  value: doublePrecision("value"),
  units: text("units"),
  label: text("label"),
  detail: jsonb("detail"),
  runId: uuid("run_id"),
});

/** A saved, read-only copy of a run, retrievable by its random code. */
export const investigations = pgTable("investigations", {
  id: uuid("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id),
  question: text("question"),
  snapshot: jsonb("snapshot").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  createdAt: createdAt(),
  lastOpenedAt: timestamp("last_opened_at", { withTimezone: true }),
  openCount: integer("open_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

/** Failed code lookups per client per 10-minute window (anti-enumeration). */
export const codeAttempts = pgTable(
  "code_attempts",
  {
    clientKey: text("client_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    failures: integer("failures").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.clientKey, t.windowStart] })],
);

/** AI calls with token counts and estimated cost, for quotas and spend alerts. */
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey(),
    createdAt: createdAt(),
    runId: uuid("run_id"),
    kind: text("kind").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    ok: boolean("ok").notNull(),
    latencyMs: integer("latency_ms").notNull().default(0),
    error: text("error"),
    clientKey: text("client_key"),
  },
  (t) => [index("ai_usage_created_idx").on(t.createdAt), index("ai_usage_client_created_idx").on(t.clientKey, t.createdAt)],
);
