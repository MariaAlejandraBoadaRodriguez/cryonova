/**
 * Contract for providers that are not read month by month through OPeNDAP:
 * asynchronous jobs (Copernicus CDS, NASA Harmony/Giovanni) and NOAA CDO
 * station data. The run executor submits one job per run and collection (or
 * per variable for Harmony), stores it in Neon (provider_jobs), checks it with
 * short requests on later invocations triggered by client polling, and only
 * downloads the result once the provider reports it ready. No request waits
 * for a job to finish.
 */
import type { BBox } from "@/src/catalog/regions";
import type { CatalogVariable, CollectionSpec } from "@/src/catalog/types";
import type { VariableMonthValue } from "./gridded";

export type ProviderJobStatus = "submitted" | "accepted" | "running" | "successful" | "failed" | "fetched";
export type RemoteProvider = "cds" | "harmony" | "noaa-cdo";

export interface ProviderJobRow {
  runId: string;
  collection: string;
  /** "all" for CDS, "stations" for NOAA, the variable key for Harmony. */
  jobKey: string;
  provider: RemoteProvider;
  /** Provider job id (CDS jobID, Harmony jobID); null when there is none. */
  jobRef: string | null;
  status: ProviderJobStatus;
  /** What was requested, without credentials. */
  request: unknown;
  meta: Record<string, unknown> | null;
  message: string | null;
  submittedAt: Date;
  checkedAt: Date | null;
  nextCheckAt: Date | null;
  completedAt: Date | null;
  checks: number;
}

export interface RemoteCredentials {
  earthdataToken?: string;
  cdsKey?: string;
  cdsUrl?: string;
  noaaToken?: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RemoteContext {
  runId: string;
  collection: CollectionSpec;
  variables: CatalogVariable[];
  bbox: BBox;
  start: string;
  end: string;
  months: string[];
  credentials: RemoteCredentials;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
}

export interface SubmitOutcome {
  jobRef: string | null;
  status: ProviderJobStatus;
  request: unknown;
  meta?: Record<string, unknown>;
  message?: string;
}

export interface CheckOutcome {
  status: ProviderJobStatus;
  message?: string;
  meta?: Record<string, unknown>;
}

export interface FetchedMonth {
  month: string;
  values: VariableMonthValue[];
}

export interface FetchOutcome {
  months: FetchedMonth[];
  bytes: number;
  durationMs: number;
  attempts: number;
  /** Example request shown in provenance (never contains credentials). */
  exampleRequest: string;
  meta?: Record<string, unknown>;
}

export interface RemoteConnector {
  provider: RemoteProvider;
  jobKeys(ctx: RemoteContext): string[];
  submit(ctx: RemoteContext, jobKey: string): Promise<SubmitOutcome>;
  check(ctx: RemoteContext, job: ProviderJobRow): Promise<CheckOutcome>;
  fetch(ctx: RemoteContext, job: ProviderJobRow): Promise<FetchOutcome>;
}

/** Seconds until the next status check: frequent at first, then once a minute. */
export function nextCheckDelaySeconds(checks: number): number {
  const schedule = [10, 15, 20, 30, 45];
  return schedule[checks] ?? 60;
}

/** True when the job is waiting on the provider. */
export function isWaiting(status: ProviderJobStatus): boolean {
  return status === "submitted" || status === "accepted" || status === "running";
}

/** Months (YYYY-MM) of a Unix time in seconds, in UTC. */
export function monthOfUnixSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 7);
}

/** True when a longitude lies inside the box (handles boxes crossing the antimeridian). */
export function lonInBox(lon: number, bbox: BBox): boolean {
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return bbox.west <= bbox.east ? x >= bbox.west - 1e-9 && x <= bbox.east + 1e-9 : x >= bbox.west - 1e-9 || x <= bbox.east + 1e-9;
}
