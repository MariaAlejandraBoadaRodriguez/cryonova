# Operations runbook

## Health and signals

| Signal | How to read it | Healthy |
|---|---|---|
| `GET /api/health` | DB latency and applied migration, connectors configured, commit | `ok: true`, `migration` = latest (2) |
| `GET /api/health?deep=ai` | One small Claude call (cached 10 min, quota-counted) | `ai.ok: true` |
| `GET /api/connectors/status` or `/sources` | Live CMR + authenticated OPeNDAP probes (cached 5 min) | MERRA-2 and IMERG `verified_live` |
| Vercel runtime logs | One JSON line per event; filter by `event` and `runId` | see below |

Structured log events (all JSON, credentials and codes redacted by `src/lib/log.ts`):
`run.created`, `run.invocation.start`, `run.discovery`, `run.read.failed` (collection, month, error kind),
`run.paused`, `run.cancelled`, `run.finished` (status, totalMs, reads, failed), `run.failed` (kind, host),
`ai.usage` (kind, model, tokens, costUsd, latencyMs), `agent.plan.ok|fallback`, `agent.explain.ok`,
`investigation.saved|opened`, `investigation.lookup.throttled`, `export.created`.

Useful queries (Vercel MCP `get_runtime_logs` or dashboard): `query: "run.failed"`, `query: "run.read.failed"`
(per-source errors), `query: "ai.usage"` (spend), `level: ["error"]`.

Plan limits observed (2026-11-14): the team is on Vercel **Hobby** — runtime logs are retained for 1 hour
(queries beyond that return HTTP 400), and `maxDuration = 300` is accepted for route handlers (the 720-read
production discovery run finished in one 146 s invocation). For longer retention, add a log drain or upgrade.
Verified event on production: `agent.explain.ok` (run `55db4e8b…`, verified 51, unverified 0) at 22:50 UTC; no
`error`-level records in the preceding 30 minutes.

## Alerts (to configure in Vercel; plan-dependent)

| Alert | Condition | Action |
|---|---|---|
| Error rate | `level=error` > 5 in 10 min | Check `run.failed` kind/host; provider outage → status page shows `error` |
| Provider failures | `run.read.failed` > 20 in 10 min for one host | Provider degraded; runs continue as `partial`; communicate |
| AI spend | daily `ai_usage.cost_usd` > 80% of `AI_DAILY_BUDGET_USD` | Raise budget or keep the automatic fallback |
| Health | `/api/health` non-200 for 5 min | DB or deploy issue; see rollback |

Daily AI spend from Neon:

```sql
select date_trunc('day', created_at) as day, kind, count(*), sum(cost_usd)::numeric(10,4) as usd
from ai_usage group by 1, 2 order by 1 desc, 2;
```

## Quotas and limits

- Runs: 30 per hour per client; at most 1,600 provider reads per run; 12 variables.
- Provider requests: 45 s deadline per attempt, 2 retries for transient errors only; 6 parallel reads per run.
- Function budget: 240 s of work per invocation (`maxDuration` 300 s); longer runs continue on the next poll.
- AI: 300 requests/day, $5/day, 20 per client per hour; refusals use server-side fallback; failures fall back to
  rule-based output.
- Code lookups: 15 failures per client per 10 minutes, then HTTP 429.

## Data retention and backups

| Table | Contents | Retention |
|---|---|---|
| `runs`, `run_samples` | live runs, per-month reads, results | Kept; prune runs older than 90 days that were not saved (manual SQL below) |
| `investigations` | saved snapshots (code hash only) | Kept until deleted on request |
| `code_attempts` | failure counters per 10-min window | Prune rows older than 1 day |
| `ai_usage` | tokens, cost, latency | Keep 1 year |

```sql
delete from run_samples where run_id in (select r.id from runs r left join investigations i on i.run_id = r.id where i.id is null and r.created_at < now() - interval '90 days');
delete from runs r where r.created_at < now() - interval '90 days' and not exists (select 1 from investigations i where i.run_id = r.id);
delete from code_attempts where window_start < now() - interval '1 day';
```

Backups: Neon keeps point-in-time history according to the project's plan (history retention window).
Restore drill (no API key in this environment, so done from the Neon console): create a branch from a past
timestamp → point a preview's `DATABASE_URL` at it → `GET /api/health` and open a saved code → delete the branch.

## Rollback

1. Find the previous good production deployment: Vercel dashboard → Deployments (filter Production), or
   `list_deployments` with `target=production`. Current production: `dpl_9gV1rokYQeF6FBRkxnVskTuPCgjn` (`4250650`); previous: `dpl_4ZHUkRnmMBSuxnxDcKeGUCeKagbD` (`c6b3a5a`), then `dpl_ELqFefi37wBsR8jeYoLgouEuPX7a` (`9456ca5`, T+3h).
2. Promote it: dashboard "Instant Rollback", or Vercel API `POST /v9/projects/{project}/rollback/{deploymentId}`.
3. Schema: migrations are additive only, so the previous build runs on the newer schema. Never drop or rename
   columns in the same release that stops using them.
4. Revert the merge on GitHub (`git revert -m 1 <merge sha>` on a branch + PR) so `master` matches production.
5. Verify `/api/health` (commit field) and one live run; record the incident in `docs/runbooks/access-matrix.md`.

Rehearsal: the T+3h production deployment is the rollback target for the T+6h–T+15h release; promoting it
restores manual runs while saved investigations remain readable (the T+3h build ignores the new tables).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Runs fail with `configuration` | `EARTHDATA_TOKEN` missing/expired | Renew the EDL token, update Vercel env, redeploy |
| Runs `partial` with `forbidden: HTTP 403` | EDL token lacks GES DISC authorization | Approve "NASA GESDISC DATA ARCHIVE" in Earthdata Login profile |
| Runs stuck `queued` | No poll since a crash | Any `GET /api/runs/{id}` resumes it after the 60 s lease |
| AI answers "automatic explanation" | Key missing, quota reached or provider error | Check `/api/health?deep=ai` and `ai.usage` logs |
