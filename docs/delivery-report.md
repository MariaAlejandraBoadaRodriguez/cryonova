# Delivery report

Date: 2026-11-14 (UTC). Everything below was observed during this session; nothing is projected.

## Published state

| Item | Value |
|---|---|
| Repository | https://github.com/MariaAlejandraBoadaRodriguez/cryonova (working branch `claude/fervent-carson-bixpbu`) |
| Pull requests | [#1](https://github.com/MariaAlejandraBoadaRodriguez/cryonova/pull/1) T+3h (merged `9456ca5`), [#2](https://github.com/MariaAlejandraBoadaRodriguez/cryonova/pull/2) T+6h–T+15h (merged `c6b3a5a`), [#3](https://github.com/MariaAlejandraBoadaRodriguez/cryonova/pull/3) BH-consistency fix found in production verification |
| Production | https://cryonova-maria-alejandra-boada-rodriguezs-projects.vercel.app → deployment `dpl_9gV1rokYQeF6FBRkxnVskTuPCgjn` from `master@425065029577aeea958efb13b888c056ce19504e` (PR #3) |
| Previous production (rollback targets) | `dpl_4ZHUkRnmMBSuxnxDcKeGUCeKagbD` (`c6b3a5a`, PR #2) and `dpl_ELqFefi37wBsR8jeYoLgouEuPX7a` (`9456ca5`, T+3h) |
| Database | Neon `neondb` (PostgreSQL 18.7): migrations `0000_initial_schema` + `0001_ai_usage_client_key` (version 2); `cryonova_test` for integration and E2E |
| CI | GitHub Actions on every push and PR: secret scan, lint, types, unit tests with coverage gate, build, pytest, browser tests — green on both merged heads |

## Checkpoints reached

| Checkpoint | Status | Evidence |
|---|---|---|
| T+3h First investigation | Done, verified in production | Run `d82edcbd…`: 240/240 MERRA-2 months, 58.9 s, +0.334 °C/decade (95% CI +0.044..+0.624, p = 0.024, n = 20) |
| T+6h AI-guided investigation | Done | Claude planner + explainer; production `/api/health?deep=ai` ok; real explanation of the production run: 62/62 figures verified (EN), 45/45 (ES) |
| T+9h Trend discovery | Done, verified in production | Run `55db4e8b…`: 4 variables from 3 products, 720/720 live reads in 146 s; BH over 4 trends (T2M nominal, q = 0.096; others inconclusive). Production verification exposed a wording gap ("significant" before correction); fixed in PR #3 and re-verified: 51/51 figures, T2M described as nominal |
| T+12h Shareable investigation | Done (locally verified end to end; production UI path awaits public access) | E2E: save → code → reopen in a separate browser → series CSV value equals the screen → PDF valid |
| T+15h Second verified path | Done | GPM IMERG V07 live (24/24 months, 5.7 s; production status `verified_live`); ERA5 and NOAA credentials accepted, connectors pending |
| T+18h Final polish | Partial | Mobile layout and axe checks pass; backup demo recording not produced |

## Acceptance criteria

| # | Criterion | Result |
|---|---|---|
| 1 | Start an investigation, select one or several variables, live results without sign-up | Met (manual journey E2E; production runs) |
| 2 | Question → editable proposal backed by the catalog; charts from source values | Met (planner tools + validation; guided E2E with rule fallback; Claude key verified in production) |
| 3 | Agent interprets a chart; every figure matches computed results | Met (verifier; 62/62 and 45/45 on production data) |
| 4 | Admin configures credentials once; connectors report real status | Met for MERRA-2/IMERG (verified live); ERA5/NOAA report "configured"; Giovanni/GLDAS/SeaWiFS "pending" |
| 5 | Save to Neon, reopen by code in another browser; refresh queries again | Met in E2E (separate browser context); production UI path awaits public access |
| 6 | Deployable app, setup instructions, tests, verified reads log | Met (README, runbooks, `docs/benchmarks/live-reads.md`) |
| 7 | Open search analyzes several variables live; findings traceable; exclusions and uncertainty shown | Met (discovery run in production; table links to each variable's chart, values and method) |
| 8 | CSV and PDF export the open investigation; values match the screen | Met (E2E compares a series CSV value with the on-screen table; PDF vector charts keep labels and units) |

## Tests

- Unit (Vitest): 123 tests; critical modules 98% lines, 85% branches (gate 80/75).
- Scientific parity (pytest + Vitest): 24 OLS+HAC cases vs statsmodels to 1e-8; Welch, BH, erfc, Student t vs scipy; the live Colombia mean recomputed in Python.
- Browser (Playwright, desktop + mobile): accessibility (axe, no serious/critical WCAG A/AA findings), keyboard path, wrong-code rejection; live journeys (manual, guided, save/reopen/export) with `LIVE_E2E=1`.

## Pending, with concrete cause

1. **Public production URL.** Vercel Authentication still covers `*.vercel.app` production URLs (`all_except_custom_domains`). The change to previews-only protection was blocked for the agent by the environment's permission policy; the owner decides (Vercel → Settings → Deployment Protection → Vercel Authentication → "Standard Protection", or add a custom domain).
2. **Tag `checkpoint-t3`.** Tag pushes are refused by the session's git policy (HTTP 403); command in `docs/checkpoints/T3.md`.
3. **ERA5, NOAA, Giovanni, GLDAS, SeaWiFS data paths.** Status reporting is live; readers are not integrated (decision D-20).
4. **Neon preview branches and restore drill.** No `NEON_API_KEY`; preview and production share `neondb` (additive migrations only). Restore drill steps are in the operations runbook.
5. **Original Databricks notebooks and 22-topic catalog.** Not present in the environment; the catalog was rebuilt from live metadata (D-04) and parity was proven against a statsmodels reference rather than the notebooks' own runs.
