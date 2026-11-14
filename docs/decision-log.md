# Decision log

Decisions taken while executing the Cryonova plan, newest last. Each entry names
the constraint that forced it, so it can be revisited when the constraint changes.

| ID | Decision | Reason | Revisit when |
|---|---|---|---|
| D-01 | Work on `claude/fervent-carson-bixpbu` instead of `feat/mvp-t3-first-investigation`; merge to `master` through PRs | The cloud session only allows pushes to this branch | Never for this session |
| D-02 | Durable runner = Vercel Functions + job state in Neon (lease, idempotency key, per-granule samples, cancellation flag, resumable time-boxed steps). Work starts in `after()` and any status poll re-kicks a stalled job | Databricks is not configured (no host/token); jobs must survive without one long HTTP response | A Databricks workspace or a Vercel Workflow/Queue is approved |
| D-03 | Scientific computation ported to TypeScript and checked against a statsmodels reference (`analytics/`, pytest + Vitest parity fixture) | Keeps one runtime on Vercel while proving parity with the Python method; notebooks 04/05/06 are not in the repo | Original notebooks are supplied (re-run parity on their selections) |
| D-04 | 22-topic MERRA-2 catalog rebuilt from live collection metadata (exact variable names, units and field counts verified via DDS/DAS) | The original analysis catalog is not available in the environment | Original catalog is supplied (reconcile topics, questions, periods) |
| D-05 | Cloud OPeNDAP (`opendap.earthdata.nasa.gov`) links taken from CMR granule metadata; DAP2 binary `.dods` decoded by our own DDS/XDR parser; EDL bearer token in the `Authorization` header | Verified live; no redirects; ~2x smaller than ASCII | Provider changes protocol |
| D-06 | Vercel deployment protection narrowed to previews only (production public) | End users have no account; production must open in a clean browser | A custom domain is added |
| D-07 | Retrieval codes: 60-bit random Crockford Base32 (`XXXX-XXXX-XXXX`), stored only as SHA-256 hash; lookups sent in POST bodies (never in URLs or logs); per-client throttling of failed attempts | Anti-enumeration and log hygiene | — |
| D-08 | CSV and PDF generated server-side from the stored run snapshot; PDF charts drawn as vector graphics with `pdf-lib` | Same data path for screen, CSV and PDF; resolution-independent charts; testable | — |
| D-09 | Fonts self-hosted with `@fontsource` (Overpass, IBM Plex Mono) | No build-time dependency on Google Fonts | — |
| D-10 | TypeScript 5.9 and ESLint 9 pinned | TypeScript 7 and ESLint 10 are too new for the Next.js 16 toolchain | Next.js documents support |
| D-11 | Node 22.x pinned through `engines` | Same runtime in dev container, CI and Vercel (project default was 26.x) | — |
| D-12 | Trend method: OLS on annual means of complete years (12 valid months), Newey–West HAC covariance (Bartlett kernel, 1 lag, no small-sample correction), normal-based p-value and 95 % CI | These are statsmodels' defaults for `fit(cov_type="HAC", cov_kwds={"maxlags": 1})`, the reference method | Notebook settings differ |
| D-13 | Preview and production share the Neon database (Vercel holds one `DATABASE_URL` for both); migrations are additive only; integration tests use a separate `cryonova_test` database | No Neon API key to create branches | `NEON_API_KEY` is provided (use a branch per preview) |
| D-14 | Region by name uses a built-in gazetteer (Natural Earth 110 m via `world-atlas`, ES/EN names via `i18n-iso-countries`) with antimeridian-aware boxes | No third-party geocoder dependency at runtime | — |
| D-15 | Plotly (`plotly.js-cartesian-dist-min`) loaded client-side through a small wrapper instead of `react-plotly.js` | Avoids an unmaintained React peer range | — |
