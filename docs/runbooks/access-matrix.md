# Access matrix

Checked on 2026-11-14 (UTC) from the Claude Code cloud environment `CRYONOVA`
(network policy: limited, exact-host allowlist). Values of secrets were never
printed; only presence and length were checked. "Dev container" is where code is
written and tested; "Vercel" is where the app runs for users.

## Repository and platforms

| Item | Status | Evidence |
|---|---|---|
| GitHub repo | OK | `origin = https://github.com/MariaAlejandraBoadaRodriguez/cryonova`; `master` and working branch both at `9398809` (README only) |
| GitHub push | **BLOCKED** (2026-11-14 20:2x UTC) | `git push` → HTTP 403 "Claude doesn't have GitHub access to MariaAlejandraBoadaRodriguez/cryonova for your organization" (5 attempts, each < 1 s). Reads through the GitHub connector work (`master` only, unprotected). Required permission: Claude GitHub App installed on the repository (https://github.com/apps/claude/installations/select_target) or GitHub re-linked at https://claude.ai/connect-github. Remaining command: `git push -u origin claude/fervent-carson-bixpbu` |
| Working branch | `claude/fervent-carson-bixpbu` | Mandated by the session; the plan's `feat/mvp-t3-first-investigation` name is replaced (see decision log D-01) |
| Vercel project | OK, exists | `cryonova` (`prj_x0sz6KFTyucW2ad8VY0ofaxGHbNZ`), team `team_k8JMHqW1mHccz5fD9Z5Toi1b`, framework Next.js, Git-connected to this repo, production branch `master`, region `iad1` |
| Vercel previous deploy | ERROR | `dpl_8hwC5UJXNgpYc1SaHJuXuGnS9js5`: `NEXT_NO_VERSION` (repo had no app) |
| Vercel deployment protection | Vercel Authentication on `all_except_custom_domains` | All `*.vercel.app` URLs require a Vercel login; must be narrowed to previews for public access (decision log D-06) |
| Vercel API from dev container | OK via `VERCEL_TOKEN` | `GET /v10/projects/{id}/env` → 200 (names only read) |
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
| `CDSAPI_URL`, `CDSAPI_KEY` | absent | present (sensitive) | Copernicus ERA5 connector |
| `NOAA_CDO_TOKEN` | absent | present (sensitive) | NOAA CDO connector |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID` | present | n/a | deployment automation |
| `EARTHDATA_USERNAME/PASSWORD` | absent | absent | not needed (bearer token) |

Consequence: AI, ERA5 and NOAA can only be verified from the deployed app
(`/api/connectors/status`), not from the dev container.

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
| `cds.climate.copernicus.eu`, `harmony.earthdata.nasa.gov`, `tile.openstreetmap.org` | ERA5, Harmony, map tiles | refused (not allowlisted); tiles load from the user's browser in production |

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
