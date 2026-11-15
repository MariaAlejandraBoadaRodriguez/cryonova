# Access matrix

First checked on 2026-11-14 (UTC); credentials re-verified on 2026-11-15 from the Claude Code cloud environment `CRYONOVA`
(network policy: limited, exact-host allowlist). Values of secrets were never
printed; only presence and length were checked. "Dev container" is where code is
written and tested; "Vercel" is where the app runs for users.

## Credential probes (2026-11-15)

`npx tsx scripts/probe-credentials.ts` sends one minimal authenticated request
per credential, each with a 60 s deadline (`AbortSignal.timeout(60_000)`), and
prints only the verdict, HTTP status, host and latency. It never prints a value,
prefix or length. Run from the dev container on 2026-11-15 05:48 UTC; the whole
probe took 2 s.

| Credential | Probe (one request, redirects not followed) | HTTP | Verdict | Latency |
|---|---|---|---|---|
| `DATABASE_URL` | Neon SQL `select 1` (pooled endpoint) | 200 | ok, database `neondb` | 488 ms |
| `DATABASE_URL_UNPOOLED` | Neon SQL `select 1` (direct endpoint) | 200 | ok, database `neondb` | 479 ms |
| `EARTHDATA_TOKEN` | Cloud OPeNDAP DDS, MERRA-2 `M2TMNXSLV` granule 2010-06 | 200 | ok | 1,478 ms |
| `EARTHDATA_TOKEN` | Cloud OPeNDAP DDS, GLDAS `GLDAS_NOAH025_M` 2.1 granule 2010-06 | 200 | ok | 1,498 ms |
| `EARTHDATA_TOKEN` | OB.DAAC cloud file (TEA) for SeaWiFS 2000-06 monthly chlor_a | 303 | ok: signed CloudFront link issued, so the OB.DAAC app approval is active | 1,876 ms |
| `EARTHDATA_TOKEN` | OB.DAAC OPeNDAP DDS (`oceandata.sci.gsfc.nasa.gov`) | 429 | rate limited from this sandbox (not an auth failure); the app falls back to the cloud file | 365 ms |
| `EARTHDATA_TOKEN` | Harmony capabilities for GLDAS (`harmony.earthdata.nasa.gov`) | 200 | ok, Giovanni services listed | 1,071 ms |
| `NOAA_CDO_TOKEN` | CDO web services v2 `/datasets?limit=1` | 200 | ok | 534 ms |
| `CDSAPI_KEY` + `CDSAPI_URL` | CDS retrieve API `/retrieve/v1/jobs?limit=1` | 200 | ok | 1,059 ms |
| `CDSAPI_KEY` + `CDSAPI_URL` | CDS `/profiles/v1/account/licences` | 200 | ok; accepted licences: `cc-by`, `data-protection-privacy-statement`, `terms-of-use-cds` | 650 ms |
| `NEON_API_KEY` + `NEON_PROJECT_ID` | Neon API `GET /api/v2/projects/{id}` | 200 | ok | 442 ms |
| `VERCEL_TOKEN` + `VERCEL_ORG_ID` | Vercel API `GET /v9/projects/cryonova` | 200 | ok | 511 ms |
| `ANTHROPIC_API_KEY` | Anthropic `GET /v1/models?limit=1` | — | not run: set in the environment settings (listed by name), but the session runtime does not pass it to the shell. It is verified on Vercel instead, where the agent uses it | — |

Notes:

- The GES DISC hydro1 OPeNDAP server (`hydro1.gesdisc.eosdis.nasa.gov`) reset
  connections from this sandbox; GLDAS is read through Cloud OPeNDAP
  (`opendap.earthdata.nasa.gov`, collection `C1342986036-GES_DISC`) instead.
- OB.DAAC's legacy `getfile` endpoint answered 416 to a ranged request, so the
  probe now checks the cloud-file (TEA) route the app uses.
- Signed download links (CloudFront for OB.DAAC and Harmony, the ECMWF object
  store for CDS) are fetched **without** credentials. Credentials are only sent
  to the host that issues the link; redirects are never followed with an
  `Authorization` header.

### Asynchronous test jobs (2026-11-15)

Submitted once each and then checked in separate calls of at most 30 s, at most
one check every 2 minutes (no command waited on a job). Queue and run times are
the provider's own `created` / `started` / `finished` timestamps (UTC).

| Job | Provider job ID | Created | Started | Finished | Status | Real value obtained |
|---|---|---|---|---|---|---|
| ERA5 monthly `2m_temperature`, 2010-06, Colombia box, NetCDF | `6606ae41-09b3-4fbd-af83-32c684b0d9d7` | 05:31:42 | 05:31:56 | 05:32:00 | successful | NetCDF-4, 31,298 B; `t2m` 68 × 49 cells in K |
| ERA5 monthly `2m_temperature`, 2010-06, Colombia box, GRIB | `7fc63848-a4fc-44db-88ad-e2c137d62923` | 05:31:44 | 06:10:42 | 06:10:46 | **accepted, queued** at the 30-minute mark (last own check 05:54:47; the session worker restarted before the 06:01 check, and the provider's start time confirms it was still queued); successful at the next check (08:40:52) | GRIB, 6,772 B (format test only; the app requests NetCDF) |
| ERA5 monthly, 10 variables, 2010-06, Colombia box, NetCDF (unit metadata) | `3895ff53-a006-4649-8ca9-bce28c29908a` | 05:47:46 | 06:48:32 | 06:48:36 | successful (queued 61 min) | ZIP of two NetCDF files (step types `avgua` and `avgad`), 185,046 B; units of all 10 variables read |
| ERA5 run through the app executor (`era5.t2m`, `era5.tp`, 2010, Colombia box) | `61b3fdc0-ef05-4d3c-b394-99d454f26cbe` | 08:55:44 | 08:55:57 | 08:56:08 | successful; fetched at the run's first due check | 2010-06: 24.547 °C (t2m), 11.10 mm/day (tp); 192,410 B |
| Harmony / Giovanni area average, GLDAS 0–10 cm soil moisture, 2010, Colombia box, CSV | `90c61434-4582-409d-aa6a-3c7a67fe6c2c` | 05:32:00 | — | 05:32:11 | successful (12 s) | 2010-06: 36.234146 kg m⁻² |
| Harmony / Giovanni area average, IMERG precipitation, 2010, Colombia box, CSV | `d2ea801d-6285-442a-b1d9-b5ed9ad0253a` | 05:47:47 | — | before 05:49:55 | successful | 2010-06: 0.4215 mm/hr (10.12 mm/day) |
| Harmony / Giovanni point time series, GLDAS | `df08b22d-c875-40d7-92c4-a268701d2c18` | 05:31 | — | — | successful, but the result link points to the Giovanni API, which needs an interactive Earthdata Login (HTML login page returned); not usable server-side | — |

## Repository and platforms

| Item | Status | Evidence |
|---|---|---|
| GitHub repo | OK | `origin = https://github.com/MariaAlejandraBoadaRodriguez/cryonova`; `master` and working branch both at `9398809` (README only) |
| GitHub push | OK since 2026-11-14 ~20:26 UTC (App access granted); first push `c8e7d39`. Earlier: **BLOCKED** | `git push` → HTTP 403 "Claude doesn't have GitHub access to MariaAlejandraBoadaRodriguez/cryonova for your organization" (5 attempts, each < 1 s). Reads through the GitHub connector work (`master` only, unprotected). Required permission: Claude GitHub App installed on the repository (https://github.com/apps/claude/installations/select_target) or GitHub re-linked at https://claude.ai/connect-github. Remaining command: `git push -u origin claude/fervent-carson-bixpbu` |
| Working branch | `claude/fervent-carson-bixpbu` | Mandated by the session; the plan's `feat/mvp-t3-first-investigation` name is replaced (see decision log D-01) |
| Vercel project | OK, exists | `cryonova` (`prj_x0sz6KFTyucW2ad8VY0ofaxGHbNZ`), team `team_k8JMHqW1mHccz5fD9Z5Toi1b`, framework Next.js, Git-connected to this repo, production branch `master`, region `iad1` |
| Vercel previous deploy | ERROR | `dpl_8hwC5UJXNgpYc1SaHJuXuGnS9js5`: `NEXT_NO_VERSION` (repo had no app) |
| Vercel deployment protection | Vercel Authentication on `all_except_custom_domains` | All `*.vercel.app` URLs require a Vercel login; must be narrowed to previews for public access (decision log D-06) |
| Vercel API from dev container | OK via `VERCEL_TOKEN` | `GET /v10/projects/{id}/env` → 200 (names only read) |
| Vercel plan | Hobby | Runtime logs retained 1 h; `maxDuration` 300 s accepted; Deployment Protection change blocked for the agent (owner decision) |
| Vercel MCP | Partial | Projects/deployments readable; listing env vars returns 403 |
| Neon PostgreSQL | OK | PostgreSQL 18.7, database `neondb`, role `neondb_owner` (CREATEDB, CREATEROLE, not superuser), empty schema before migrations |
| Neon access path in dev container | HTTPS only | Direct TCP 5432 impossible (no DNS); SQL-over-HTTP works through the endpoint host (`scripts/lib/dev-proxy.ts`) |
| Databricks | Not available | No `DATABRICKS_HOST` / `DATABRICKS_TOKEN`; notebooks 04/05/06 not present in repo (decision log D-03) |

## Secrets (names only)

| Secret | Dev container | Vercel (production + preview) | Used by |
|---|---|---|---|
| `DATABASE_URL` (pooled) | present | present (sensitive) | app runtime |
| `DATABASE_URL_UNPOOLED` (direct) | present | present (sensitive) | migrations |
| `ANTHROPIC_API_KEY` | configured in environment settings but **not exposed to the shell** | present (sensitive) | agent (server only) |
| `ANTHROPIC_MODEL` | present (`claude-sonnet-5-5`) | present (sensitive) | agent |
| `EARTHDATA_TOKEN` | present (EDL bearer token) | present (sensitive) | MERRA-2, IMERG via OPeNDAP |
| `CDSAPI_URL`, `CDSAPI_KEY` | present (since 2026-11-15) | present (sensitive) | Copernicus ERA5 connector |
| `NOAA_CDO_TOKEN` | present (since 2026-11-15) | present (sensitive) | NOAA CDO connector |
| `NEON_API_KEY`, `NEON_PROJECT_ID` | present (since 2026-11-15) | n/a (GitHub Actions secrets) | per-PR Neon branches in CI |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID` | present | n/a | deployment automation |
| `EARTHDATA_USERNAME/PASSWORD` | absent | absent | not needed (bearer token) |

Since 2026-11-15 ERA5 and NOAA are verified from the dev container as well;
the Anthropic key is still only exercised on Vercel (see the probe table above).
The same credentials are stored as GitHub Actions secrets for CI.

## Network (dev container)

Initially every non-registry host was refused by the egress proxy (HTTP 403 on
CONNECT). The owner approved this exact-host allowlist on 2026-11-14:

| Host | Purpose | Result after allowlisting |
|---|---|---|
| `cmr.earthdata.nasa.gov` | catalog and granule discovery | 200, ~0.2 s |
| `opendap.earthdata.nasa.gov` | Cloud OPeNDAP subsetting (MERRA-2, IMERG) | 200 with `Authorization: Bearer` (no redirect) |
| `urs.earthdata.nasa.gov` | Earthdata Login | flaky: one TLS timeout at 10 s, then 200 in 0.39 s; not on the bearer-token path |
| `goldsmr4.gesdisc.eosdis.nasa.gov`, `gpm1.gesdisc.eosdis.nasa.gov`, `data.gesdisc.earthdata.nasa.gov` | GES DISC legacy/data endpoints | 200 |
| `hydro1.gesdisc.eosdis.nasa.gov` | GLDAS hydrology | first probe: connection reset; retest: 200 twice |
| `oceandata.sci.gsfc.nasa.gov` | SeaWiFS L3m | 200 |
| `www.ncei.noaa.gov` | NOAA NCEI/CDO | 200 |
| `ep-lively-voice-bd2gpfu9[-pooler].c-8.us-east-2.aws.neon.tech` | Neon SQL over HTTPS | 200 for `/sql` |
| `api.vercel.com` | Vercel REST API | 200 |
| `cryonova-maria-alejandra-boada-rodriguezs-projects.vercel.app` | production smoke tests | reachable |
| `api.c-8.us-east-2.aws.neon.tech` | Neon driver default HTTP host | **refused (not allowlisted)**; worked around with the endpoint host |
| `cds.climate.copernicus.eu` | ERA5 retrieve API (allowlisted 2026-11-15) | 200 |
| `object-store.os-api.cci2.ecmwf.int` | ERA5 result downloads (signed, no credentials sent) | 200 |
| `harmony.earthdata.nasa.gov` | Harmony / Giovanni services (allowlisted 2026-11-15) | 200 |
| `dqzb5lcolc8fj.cloudfront.net` | Harmony result downloads (signed, no credentials sent) | 200 |
| `obdaac-tea.earthdatacloud.nasa.gov`, `dwgofd1fffpxv.cloudfront.net` | OB.DAAC cloud files and their signed links | 303 then 200 |
| `api.giovanni.earthdata.nasa.gov` | Giovanni API | reachable, but requires interactive Earthdata Login; not used |
| `console.neon.tech` | Neon API (branches) | 200 |
| `tile.openstreetmap.org` | map tiles | not needed: the globe and maps use bundled assets only |

## Live reads verified from the dev container

| Source | Request | Result |
|---|---|---|
| MERRA-2 `M2TMNXSLV` 5.12.4 (`C1276812859-GES_DISC`) | CMR collection + granules 2005-01..03 | 200; each granule exposes a Cloud OPeNDAP service link |
| MERRA-2 granule `MERRA2_300.tavgM_2d_slv_Nx.200501.nc4` | `.dds`, `.das` | 200; **94 grid fields** (matches the Databricks evidence in the plan); `T2M` units `K`, `_FillValue 9.99999987e+14` |
| MERRA-2 Colombia box, January 2005 | `.dods?T2M[0:0][172:205][162:181],lat[172:205],lon[162:181]` | 200, 3,937 bytes, 1.84 s, 680 cells; cos-lat weighted mean **298.373 K (25.223 °C)** |
| GPM IMERG monthly `GPM_3IMERGM` 07 (`C2723754851-GES_DISC`) | CMR granules 2005-01..2025-12 | **249 of 252 months** (collection currently ends 2025-09; matches the plan's evidence) |
| IMERG granule 2005-01 | `.dds` | 200; `/Grid/precipitation[time][lon][lat]` (lon-major, unlike MERRA-2) |

## Incident: hung probe (2026-11-14)

A shell probe (`curl … IMERG .dds | head -40`) ran for about 26 minutes before
the owner interrupted it, although curl had `-m 60`. Root cause was not isolated;
the pipeline had no wall-clock cap of its own.

Mitigations now in force:

- Every shell probe runs under `timeout -k 5 <seconds>` in addition to curl's
  `--connect-timeout` and `--max-time`, with at most two retries.
- Every provider request in the application uses `AbortSignal.timeout(...)`, a
  bounded retry policy (`src/lib/http.ts`) and a per-run time budget, so no job
  depends on a request that never returns.
- The retry of the single-month Colombia subset succeeded on the first attempt
  (200, 1.84 s).
