/**
 * NASA Harmony connector for Giovanni area averages.
 *
 * One OGC API EDR "cube" request per variable with average=area and CSV
 * output. Harmony answers with a redirect to an asynchronous job; the job id is
 * stored and checked with short requests. When the job is successful, its data
 * link is resolved on harmony.earthdata.nasa.gov (with the Earthdata token,
 * redirect not followed) to a signed CloudFront URL that is fetched without
 * credentials. The CSV holds one area-averaged value per month.
 */
import { lastDayOfMonth } from "@/src/providers/cmr";
import { parseJson, parseText, ProviderError, redirectLocation, requestWithPolicy } from "@/src/lib/http";
import { POLICIES, withSignal } from "./policies";
import type { CheckOutcome, FetchedMonth, FetchOutcome, ProviderJobRow, ProviderJobStatus, RemoteConnector, RemoteContext, SubmitOutcome } from "./remote";

export const HARMONY = "https://harmony.earthdata.nasa.gov";
const HOST = "harmony.earthdata.nasa.gov";

export function cubeUrl(ctx: Pick<RemoteContext, "collection" | "bbox" | "start" | "end">, field: string): string {
  const { west, south, east, north } = ctx.bbox;
  const params = new URLSearchParams({
    bbox: [west, south, east, north].join(","),
    datetime: `${ctx.start}-01T00:00:00Z/${lastDayOfMonth(ctx.end)}T23:59:59Z`,
    "parameter-name": field,
    f: "text/csv",
    average: "area",
  });
  return `${HARMONY}/ogc-api-edr/1.1.0/collections/${ctx.collection.conceptId}/cube?${params.toString()}`;
}

export function mapHarmonyStatus(status: string | undefined): ProviderJobStatus {
  switch (status) {
    case "accepted":
    case "previewing":
    case "paused":
      return "accepted";
    case "running":
    case "running_with_errors":
      return "running";
    case "successful":
    case "complete_with_errors":
      return "successful";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return "running";
  }
}

/** Parses Giovanni's area-average CSV: header lines, then "time,mean_<field>". */
export function parseGiovanniCsv(csv: string, column: string, fillValue: number): Array<{ month: string; value: number | null }> {
  const lines = csv.split(/\r?\n/);
  const fill = /^Fill Value:,\s*(-?[\d.eE+-]+)/m.exec(csv);
  const declaredFill = fill ? Number(fill[1]) : fillValue;
  const header = lines.findIndex((line) => line.startsWith("time,"));
  if (header < 0) throw new ProviderError("bad_response", "Giovanni CSV has no time column", HOST, 1);
  const columns = lines[header]!.split(",");
  const index = columns.indexOf(column);
  if (index < 0) throw new ProviderError("bad_response", `Giovanni CSV has no column ${column}`, HOST, 1);
  const out: Array<{ month: string; value: number | null }> = [];
  for (const line of lines.slice(header + 1)) {
    if (!line.trim()) continue;
    const cells = line.split(",");
    const month = (cells[0] ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const value = Number(cells[index]);
    const missing = !Number.isFinite(value) || Math.abs(value - declaredFill) <= Math.abs(declaredFill) * 1e-6;
    out.push({ month, value: missing ? null : value });
  }
  return out;
}

function token(ctx: RemoteContext): string {
  const value = ctx.credentials.earthdataToken;
  if (!value) throw new ProviderError("unauthorized", "The NASA Earthdata token is not configured on the server (EARTHDATA_TOKEN).", HOST, 0);
  return value;
}

interface HarmonyJob {
  status?: string;
  message?: string;
  progress?: number;
  links?: Array<{ rel?: string; href: string; title?: string }>;
}

export const harmonyConnector: RemoteConnector = {
  provider: "harmony",
  jobKeys: (ctx) => ctx.variables.map((v) => v.key),

  async submit(ctx, jobKey): Promise<SubmitOutcome> {
    const variable = ctx.variables.find((v) => v.key === jobKey);
    if (!variable?.requestName) throw new ProviderError("bad_request", `No Giovanni field for ${jobKey}`, HOST, 0);
    const url = cubeUrl(ctx, variable.requestName);
    const location = await redirectLocation(url, { Authorization: `Bearer ${token(ctx)}` }, withSignal(POLICIES.jobSubmit, ctx.signal), ctx.fetchImpl);
    const id = /\/jobs\/([0-9a-f-]{36})/.exec(location.value)?.[1];
    if (!id) throw new ProviderError("bad_response", "Harmony did not return a job link", HOST, location.attempts, location.status);
    return { jobRef: id, status: "accepted", request: { url }, message: "Harmony job accepted" };
  },

  async check(ctx, job): Promise<CheckOutcome> {
    const response = await requestWithPolicy(`${HARMONY}/jobs/${job.jobRef}`, { headers: { Authorization: `Bearer ${token(ctx)}`, Accept: "application/json" } }, withSignal(POLICIES.jobCheck, ctx.signal), parseJson<HarmonyJob>, ctx.fetchImpl);
    const status = mapHarmonyStatus(response.value.status);
    const progress = typeof response.value.progress === "number" ? ` (${response.value.progress}%)` : "";
    return { status, message: `Harmony job ${response.value.status ?? "unknown"}${progress}${status === "failed" && response.value.message ? `: ${response.value.message.slice(0, 240)}` : ""}` };
  },

  async fetch(ctx, job: ProviderJobRow): Promise<FetchOutcome> {
    const started = Date.now();
    const variable = ctx.variables.find((v) => v.key === job.jobKey);
    if (!variable) throw new ProviderError("bad_request", `Unknown variable ${job.jobKey}`, HOST, 0);
    const auth = { Authorization: `Bearer ${token(ctx)}` };
    const status = await requestWithPolicy(`${HARMONY}/jobs/${job.jobRef}`, { headers: { ...auth, Accept: "application/json" } }, withSignal(POLICIES.jobCheck, ctx.signal), parseJson<HarmonyJob>, ctx.fetchImpl);
    const data = (status.value.links ?? []).find((l) => l.rel === "data");
    if (!data) throw new ProviderError("bad_response", "Harmony job has no data link", HOST, status.attempts);
    // The token goes only to Harmony; the signed CloudFront link is fetched without it.
    const signed = await redirectLocation(data.href, auth, withSignal(POLICIES.signedLink, ctx.signal), ctx.fetchImpl);
    const csv = await requestWithPolicy(signed.value, {}, withSignal(POLICIES.fileDownload, ctx.signal), parseText, ctx.fetchImpl);
    const rows = parseGiovanniCsv(csv.value, variable.dapName, variable.fillValue);
    const wanted = new Set(ctx.months);
    const months: FetchedMonth[] = rows
      .filter((r) => wanted.has(r.month))
      .map((r) => ({ month: r.month, values: [{ key: variable.key, mean: r.value, validCells: r.value === null ? 0 : 1, totalCells: 1 }] }));
    return {
      months,
      bytes: csv.value.length,
      durationMs: Date.now() - started,
      attempts: status.attempts + signed.attempts + csv.attempts,
      exampleRequest: `${(job.request as { url?: string })?.url ?? cubeUrl(ctx, variable.requestName ?? "")} → job ${job.jobRef}`,
      meta: { resultHost: new URL(signed.value).host, service: "giovanni-averaging-service" },
    };
  },
};
