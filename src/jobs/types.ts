import type { VariableAnalysis } from "@/src/analytics/analyze";
import type { IndexRange } from "@/src/providers/grid";
import type { VariableMonthValue } from "@/src/providers/gridded";
import type { Selection } from "./selection";

export type RunStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "cancelled";
export const TERMINAL_STATUSES: RunStatus[] = ["succeeded", "partial", "failed", "cancelled"];

export interface RunError {
  kind: string;
  message: string;
  host?: string;
}

export interface RunProgress {
  phase: "queued" | "discovering" | "reading" | "analyzing" | "done";
  tasksTotal?: number;
  tasksDone?: number;
  tasksFailed?: number;
  tasksMissing?: number;
  bytes?: number;
  invocations?: number;
  timings?: Partial<RunTimings>;
  message?: string;
}

export interface RunRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  status: RunStatus;
  mode: string;
  question: string | null;
  selection: unknown;
  idempotencyKey: string;
  clientKey: string | null;
  parentRunId: string | null;
  progress: RunProgress;
  leaseOwner: string | null;
  leaseUntil: Date | null;
  attempts: number;
  cancelRequested: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: RunError | null;
  result: RunResult | null;
  explanation: unknown;
}

export interface NewRun {
  id: string;
  selection: Selection;
  idempotencyKey: string;
  clientKey: string | null;
  parentRunId?: string | null;
}

export type SampleStatus = "pending" | "ok" | "missing" | "failed";

export interface SampleRow {
  runId: string;
  collection: string;
  month: string;
  status: SampleStatus;
  granuleId: string | null;
  granuleTitle: string | null;
  opendapUrl: string | null;
  values: VariableMonthValue[] | null;
  bytes: number | null;
  durationMs: number | null;
  attempts: number;
  error: string | null;
  fetchedAt: Date | null;
}

export interface RunTimings {
  queueMs: number;
  discoveryMs: number;
  readWallMs: number;
  readSumMs: number;
  analysisMs: number;
  totalMs: number;
  invocations: number;
  concurrency: number;
}

export interface SourceProvenance {
  collection: string;
  conceptId: string;
  version: string;
  title: string;
  provider: string;
  doi: string | null;
  citation: string;
  landingPage: string;
  cmrQuery: string;
  granulesFound: number;
  monthsRequested: number;
  monthsRead: number;
  monthsFailed: number;
  monthsMissing: number;
  firstGranule: string | null;
  lastGranule: string | null;
  exampleRequest: string | null;
  fetchedFrom: string | null;
  fetchedTo: string | null;
  bytes: number;
  readMs: { median: number; p95: number; max: number };
  window: { lat: IndexRange; lon: IndexRange[]; cells: number; nativeCells: number; stride: number; snapped: boolean; resolution: string };
  access: string;
}

export interface VariableResult {
  key: string;
  name: { en: string; es: string };
  source: string;
  collection: string;
  product: string;
  version: string;
  dapName: string;
  providerLongName: string;
  domain: string;
  unitGroup: string;
  aggregation: string;
  analysis: VariableAnalysis;
}

export interface RunResult {
  schemaVersion: 1;
  runId: string;
  status: "succeeded" | "partial" | "failed";
  createdAt: string;
  completedAt: string;
  selection: Selection;
  region: { bbox: Selection["region"]["bbox"]; name: string | null; crossesAntimeridian: boolean };
  variables: VariableResult[];
  sources: SourceProvenance[];
  timings: RunTimings;
  warnings: string[];
}
