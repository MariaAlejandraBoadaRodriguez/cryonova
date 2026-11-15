/**
 * Credential probes: one minimal authenticated request per credential, each
 * capped at 60 s. Prints presence, the HTTP status and a verdict; never prints
 * a value, a prefix or a length.
 *
 *   npx tsx scripts/probe-credentials.ts [--json]
 */
import { neon } from "@neondatabase/serverless";
import { enableDevProxy } from "./lib/dev-proxy";

enableDevProxy();

const TIMEOUT_MS = 60_000;
const SEAWIFS_FILE = "SEASTAR_SEAWIFS_GAC.20000601_20000630.L3m.MO.CHL.chlor_a.9km.nc";

interface Probe {
  credential: string;
  purpose: string;
  host: string;
  status: number | null;
  verdict: "ok" | "auth_failed" | "blocked_by_sandbox" | "missing" | "error";
  detail: string;
  ms: number;
}

function classify(error: unknown): { verdict: Probe["verdict"]; detail: string } {
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  if (/403|tunnel|proxy|blocked/i.test(text) && /proxy|tunnel/i.test(text)) return { verdict: "blocked_by_sandbox", detail: "the session's egress proxy refused the host" };
  if (/timeout|aborted/i.test(text)) return { verdict: "error", detail: "no answer within 60 s" };
  return { verdict: "error", detail: text.replace(/\s+/g, " ").slice(0, 140) };
}

async function http(credential: string, purpose: string, url: string, init: RequestInit, judge?: (status: number, body: string, location: string) => { verdict: Probe["verdict"]; detail: string }): Promise<Probe> {
  const host = new URL(url).host;
  const started = Date.now();
  try {
    const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.text().catch(() => "");
    // An egress-proxy refusal is a 403 with a plain-text body naming the policy.
    if (response.status === 403 && /request blocked|no rule allows host/i.test(body)) return { credential, purpose, host, status: 403, verdict: "blocked_by_sandbox", detail: "the session's egress proxy refused the host", ms: Date.now() - started };
    const judged = judge?.(response.status, body, response.headers.get("location") ?? "") ?? (response.ok ? { verdict: "ok" as const, detail: "accepted" } : response.status === 401 || response.status === 403 ? { verdict: "auth_failed" as const, detail: "credentials rejected" } : { verdict: "error" as const, detail: `unexpected HTTP ${response.status}` });
    return { credential, purpose, host, status: response.status, ...judged, ms: Date.now() - started };
  } catch (error) {
    return { credential, purpose, host, status: null, ...classify(error), ms: Date.now() - started };
  }
}

async function sql(credential: string, url: string | undefined): Promise<Probe> {
  if (!url) return { credential, purpose: "Neon SQL", host: "—", status: null, verdict: "missing", detail: "not set in this process", ms: 0 };
  const host = new URL(url.replace(/^postgres(ql)?:/, "https:")).host;
  const started = Date.now();
  try {
    const rows = await neon(url, { fetchOptions: { signal: AbortSignal.timeout(TIMEOUT_MS) } })`select 1 as ok, current_database() as db`;
    return { credential, purpose: "Neon SQL", host, status: 200, verdict: rows[0]?.ok === 1 ? "ok" : "error", detail: `database ${rows[0]?.db}`, ms: Date.now() - started };
  } catch (error) {
    return { credential, purpose: "Neon SQL", host, status: null, ...classify(error), ms: Date.now() - started };
  }
}

function missing(credential: string, purpose: string): Probe {
  return { credential, purpose, host: "—", status: null, verdict: "missing", detail: "not set in this process", ms: 0 };
}

async function main(): Promise<void> {
  const env = process.env;
  const edl = env.EARTHDATA_TOKEN;
  const cdsUrl = (env.CDSAPI_URL || "https://cds.climate.copernicus.eu/api").replace(/\/$/, "");
  const probes = await Promise.all([
    sql("DATABASE_URL", env.DATABASE_URL),
    sql("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED),
    edl
      ? http("EARTHDATA_TOKEN", "GES DISC cloud OPeNDAP (MERRA-2 DDS)", "https://opendap.earthdata.nasa.gov/collections/C1276812859-GES_DISC/granules/M2TMNXSLV.5.12.4%3AMERRA2_300.tavgM_2d_slv_Nx.201006.nc4.dds", { headers: { Authorization: `Bearer ${edl}` } })
      : missing("EARTHDATA_TOKEN", "Earthdata Login"),
    edl
      ? http("EARTHDATA_TOKEN", "GES DISC cloud OPeNDAP (GLDAS DDS)", "https://opendap.earthdata.nasa.gov/collections/C1342986036-GES_DISC/granules/GLDAS_NOAH025_M.2.1%3AGLDAS_NOAH025_M.A201006.021.nc4.dds", { headers: { Authorization: `Bearer ${edl}` } })
      : missing("EARTHDATA_TOKEN", "GLDAS"),
    edl
      ? http("EARTHDATA_TOKEN", "OB.DAAC cloud file (SeaWiFS, app approval)", `https://obdaac-tea.earthdatacloud.nasa.gov/ob-cumulus-prod-public/${SEAWIFS_FILE}`, { headers: { Authorization: `Bearer ${edl}` } }, (status, _body, location) =>
          [301, 302, 303, 307].includes(status) && /cloudfront\.net|amazonaws\.com/.test(location)
            ? { verdict: "ok", detail: "signed download link issued (redirect not followed)" }
            : [301, 302, 303, 307].includes(status) && /urs\.earthdata/.test(location)
              ? { verdict: "auth_failed", detail: "redirected to Earthdata Login: token or OB.DAAC approval not accepted" }
              : status === 401 || status === 403
                ? { verdict: "auth_failed", detail: "credentials rejected" }
                : { verdict: "error", detail: `unexpected HTTP ${status}` },
        )
      : missing("EARTHDATA_TOKEN", "OB.DAAC"),
    edl
      ? http("EARTHDATA_TOKEN", "OB.DAAC OPeNDAP (SeaWiFS DDS)", `https://oceandata.sci.gsfc.nasa.gov/opendap/SeaWiFS/L3SMI/2000/0601/${SEAWIFS_FILE}.dds`, { headers: { Authorization: `Bearer ${edl}` } }, (status) =>
          status === 200 ? { verdict: "ok", detail: "accepted" } : status === 429 ? { verdict: "error", detail: "rate limited (HTTP 429); the app falls back to the cloud file" } : status === 401 || status === 403 ? { verdict: "auth_failed", detail: "credentials rejected" } : { verdict: "error", detail: `unexpected HTTP ${status}` },
        )
      : missing("EARTHDATA_TOKEN", "OB.DAAC OPeNDAP"),
    edl
      ? http("EARTHDATA_TOKEN", "Harmony (Giovanni services, GLDAS)", "https://harmony.earthdata.nasa.gov/capabilities?collectionId=C1342986036-GES_DISC", { headers: { Authorization: `Bearer ${edl}` } }, (status, body) =>
          status === 200 ? { verdict: "ok", detail: /giovanni/i.test(body) ? "capabilities list Giovanni services" : "accepted (no Giovanni service listed)" } : status === 401 || status === 403 ? { verdict: "auth_failed", detail: "credentials rejected" } : { verdict: "error", detail: `unexpected HTTP ${status}` },
        )
      : missing("EARTHDATA_TOKEN", "Harmony"),
    env.NOAA_CDO_TOKEN ? http("NOAA_CDO_TOKEN", "NOAA CDO web services v2", "https://www.ncei.noaa.gov/cdo-web/api/v2/datasets?limit=1", { headers: { token: env.NOAA_CDO_TOKEN } }) : missing("NOAA_CDO_TOKEN", "NOAA CDO"),
    env.CDSAPI_KEY ? http("CDSAPI_KEY + CDSAPI_URL", "CDS account (retrieve API)", `${cdsUrl}/retrieve/v1/jobs?limit=1`, { headers: { "PRIVATE-TOKEN": env.CDSAPI_KEY } }) : missing("CDSAPI_KEY", "Copernicus CDS"),
    env.CDSAPI_KEY ? http("CDSAPI_KEY + CDSAPI_URL", "CDS accepted licences", `${cdsUrl}/profiles/v1/account/licences`, { headers: { "PRIVATE-TOKEN": env.CDSAPI_KEY } }, (status, body) => (status === 200 ? { verdict: "ok", detail: `licences: ${(body.match(/"id"\s*:\s*"([^"]+)"/g) ?? []).map((m) => m.replace(/.*"([^"]+)"$/, "$1")).join(", ") || "none listed"}` } : status === 401 || status === 403 ? { verdict: "auth_failed", detail: "credentials rejected" } : { verdict: "error", detail: `unexpected HTTP ${status}` })) : missing("CDSAPI_KEY", "Copernicus CDS"),
    env.NEON_API_KEY && env.NEON_PROJECT_ID ? http("NEON_API_KEY + NEON_PROJECT_ID", "Neon API (project)", `https://console.neon.tech/api/v2/projects/${env.NEON_PROJECT_ID}`, { headers: { Authorization: `Bearer ${env.NEON_API_KEY}`, Accept: "application/json" } }) : missing("NEON_API_KEY / NEON_PROJECT_ID", "Neon API"),
    env.VERCEL_TOKEN ? http("VERCEL_TOKEN + VERCEL_ORG_ID", "Vercel API (project)", `https://api.vercel.com/v9/projects/cryonova${env.VERCEL_ORG_ID ? `?teamId=${env.VERCEL_ORG_ID}` : ""}`, { headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` } }) : missing("VERCEL_TOKEN", "Vercel API"),
    env.ANTHROPIC_API_KEY ? http("ANTHROPIC_API_KEY", "Anthropic API (models)", "https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" } }) : missing("ANTHROPIC_API_KEY", "Anthropic API"),
  ]);
  if (process.argv.includes("--json")) console.log(JSON.stringify(probes, null, 2));
  else for (const p of probes) console.log(`${p.verdict.padEnd(19)} ${String(p.status ?? "—").padEnd(4)} ${p.credential.padEnd(31)} ${p.purpose.padEnd(38)} ${p.host.padEnd(46)} ${String(p.ms).padStart(6)} ms  ${p.detail}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
