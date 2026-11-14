# Verified live reads

Every row is a real query to the provider at the time shown. Nothing here was
precomputed; runs are reproducible by repeating the selection.

| When (UTC) | Where | Selection | Reads | Wall time | Result |
|---|---|---|---|---|---|
| 2026-11-14 20:31 | dev container, curl | MERRA-2 M2TMNXSLV T2M, Colombia box (lat 172–205, lon 162–181), 2005-01 | 1 granule, 3,937 B, 1.84 s | — | cos-lat mean 298.373 K (25.223 °C), 680 cells |
| 2026-11-14 20:36 | dev container, executor (memory store) | T2M, Colombia (gazetteer box), 2015-01..2016-12 | 24/24, 0 failed | 7.0 s (6 workers; median 1.49 s, p95 1.89 s) | trend correctly "insufficient" (2 years) |
| 2026-11-14 20:37 | dev container, executor (Neon `cryonova_test`) | T2M, Colombia, 2005-01..2024-12 | 240/240, 0 failed, 886 KB | 53.4 s (median 1.31 s, p95 1.65 s) | **+0.334 °C/decade, 95% CI +0.044..+0.624, p = 0.024, n = 20** |
| 2026-11-14 20:50 | local production build, browser (Playwright) | T2M, Colombia, 2012-01..2023-12 | 144/144 | 35–39 s journey | +0.56 °C/decade, 95% CI +0.21..+0.90, p = 0.002, n = 12 |
| 2026-11-14 21:02 | **Vercel production** `dpl_ELqFefi37wBsR8jeYoLgouEuPX7a` (`master@9456ca5`), run `d82edcbd-17fb-41e7-b048-df0062b128a9` | T2M, Colombia, 2005-01..2024-12 | 240/240, 0 failed, 886,320 B | 58.9 s total (queue 5.8 s, CMR 0.36 s, reads 52.6 s with 6 workers; median 1.33 s, p95 1.68 s), 1 invocation | **+0.334 °C/decade, 95% CI +0.044..+0.624, p = 0.024, n = 20** (identical to the dev run) |

| 2026-11-14 21:26 | **Vercel production** `c6b3a5a`, run `55db4e8b-315b-4cff-8006-2a7c8bf14d00` (discovery) | T2M, QV2M (M2TMNXSLV), PRECTOTCORR (M2TMNXFLX), IMERG precipitation (GPM_3IMERGM); Colombia, 2005-01..2024-12 | **720/720, 0 failed**; IMERG 5,124 cells/month (every 2 cells) | 146.4 s total (queue 5.9 s, CMR 0.85 s, reads 139.4 s with 6 workers; medians 1.18 / 1.32 / 1.15 s), 1 invocation | BH over 4 trends: T2M +0.334 °C/decade (p 0.024, q 0.096, **nominal**); QV2M +0.245 g/kg (p 0.064), MERRA-2 precipitation +0.354 mm/day (p 0.084), IMERG precipitation -0.087 mm/day (p 0.421), all inconclusive. The two precipitation products disagree in sign. |

Additional analyses from the production run (same selection): SON trend
+0.453 °C/decade (95% CI +0.108..+0.797, p = 0.010); DJF, MAM, JJA intervals
include zero. 2015–2024 mean 25.153 °C vs 2005–2014 mean 24.760 °C, difference
+0.393 °C (Welch p = 0.016). Warmest year 2024 (25.878 °C). Longest run of
positive monthly anomalies: 21 months (2023-04 to 2024-12).

## GPM IMERG (second NASA path)

| When (UTC) | Request | Result |
|---|---|---|
| 2026-11-14 19:58 | CMR granules `C2723754851-GES_DISC` 2005-01..2025-12 | 249 of 252 months (collection ends 2025-09), matching the Databricks evidence |
| 2026-11-14 20:15 | `.das` and coordinate endpoints of 2005-01 granule | `precipitation` in mm/hr, fill -9999.9, lat -89.95..89.95, lon -179.95..179.95, lon-major |
| 2026-11-14 21:18 | Executor (memory store), Colombia 2015-01..2016-12 | 24/24 months, 0 failed, 5.7 s; 5,124 cells per month (0.1° grid, every 2 cells); Jan 2015 = 5.68 mm/day |
| 2026-11-14 21:25 | Production preview `/api/connectors/status` | MERRA-2 and IMERG `verified_live` (latest granules 2026-09 and 2025-09); ERA5 catalogue reachable with credentials; NOAA CDO token accepted |

## AI checks on Vercel

| When (UTC) | Deployment | Check | Result |
|---|---|---|---|
| 2026-11-14 21:10 | preview `d937e48` | `/api/health?deep=ai` | ok, `claude-sonnet-5-5`, 1.29 s |
| 2026-11-14 21:11 | preview `dfa4410` | Explanation of production run `d82edcbd…` (EN) | Claude, 6.6 s, 1,942 in / 731 out tokens (~$0.012); **62/62 cited figures verified** |
| 2026-11-14 21:12 | preview `dfa4410` | Same run (ES) | Claude, 6.6 s; **45/45 cited figures verified** |
| 2026-11-14 21:26 | production `c6b3a5a` | `/api/health?deep=ai` | ok, `claude-sonnet-5-5`, 1.37 s |
| 2026-11-14 21:29 | production `c6b3a5a` | Explanation of discovery run `55db4e8b…` (EN) | Claude, 6.2 s, 4,533 in / 897 out tokens (~$0.018); 46/46 figures verified. Found a wording gap: T2M was called "significant" although BH rates it nominal; fixed in PR #3 (run-level q-values in badges, PDF and AI facts). |
| 2026-11-14 22:50 | production `4250650` (PR #3) | Same discovery run, interpretation regenerated after the fix | Claude, 7.0 s, 4,739 in / 940 out tokens (~$0.019); **51/51 figures verified**; T2M now described as "only nominally significant and not significant after Benjamini-Hochberg correction (q = 0.096)" |
