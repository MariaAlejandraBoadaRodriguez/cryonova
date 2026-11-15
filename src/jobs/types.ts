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
  /** While provider jobs are queued: the run is not resumed before this time (ISO). */
  waitUntil?: string;
  /** Provider jobs this run waits on, for the progress view. */
  jobs?: Array<{ collection: string; provider: string; jobRef: string | null; status: string; message: string | null; submittedAt: string; checks: number }>;
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
  via?: string | null;
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
  /** grid = Cryonova averaged the cells; service = the provider computed the area average; stations = point observations. */
  kind?: "grid" | "service" | "stations";
  /** Organisation serving the data (NASA Earthdata, Copernicus Climate Data Store, NOAA NCEI…). */
  servedBy?: string;
  /** "M2TMNXSLV v5.12.4" or "ERA5_SL_MONTHLY (CDS)". */
  label?: string;
  /** Asynchronous provider jobs behind this source. */
  jobs?: Array<{ provider: string; jobRef: string | null; status: string; submittedAt: string; completedAt: string | null; checks: number; message: string | null }>;
  /** OB.DAAC: months read as OPeNDAP subsets vs. full cloud files. */
  readsVia?: { opendap: number; cloudFile: number };
  /** NOAA: stations considered for the area. */
  stations?: Array<{ id: string; name: string; lat: number; lon: number; elevation: number | null }>;
}

export interface StationResult {
  id: string;
  name: string;
  lat: number;
  lon: number;
  elevation: number | null;
  monthsValid: number;
  /** Mean over the station's valid months, in display units. */
  mean: number | null;
  usedInRegionalMean: boolean;
  trendPerDecade: number | null;
  trendPValue: number | null;
  firstMonth: string | null;
  lastMonth: string | null;
  /** Monthly values in display units (null = no report). */
  monthly: Array<{ month: string; value: number | null }>;
}

export interface VariableResult {
  key: string;
  name: { en: string };
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
  geometry?: "grid" | "stations";
  /** Station data: one entry per station considered. */
  stations?: StationResult[];
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
